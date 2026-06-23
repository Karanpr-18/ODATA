"""
Respond Node — Formats the final response for the user, combining
OData results, calculation outputs, or direct answers into a
clean, presentable message.
"""

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage

from app.graph.state import AgentState

logger = logging.getLogger(__name__)


def _format_table(data: list[dict]) -> str:
    """Format a list of dicts as a Markdown table."""
    if not data:
        return "_No data available._"

    # Get all unique keys
    headers = list(data[0].keys())

    # Build markdown table
    lines = []
    lines.append("| " + " | ".join(str(h) for h in headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")

    for row in data[:50]:  # Limit to 50 rows in display
        values = [str(row.get(h, "")) for h in headers]
        lines.append("| " + " | ".join(values) + " |")

    if len(data) > 50:
        lines.append(f"\n_...and {len(data) - 50} more records._")

    return "\n".join(lines)


def _try_generate_chart_json(data: list[dict], user_query: str) -> str:
    """Detect if a chart is requested and generate a chart JSON block."""
    if not data:
        return ""

    query_lower = user_query.lower()
    
    # Check if a chart is requested
    chart_keywords = ["chart", "pie", "bar", "line", "area", "graph", "plot"]
    if not any(k in query_lower for k in chart_keywords):
        return ""

    # Detect chart type
    chart_type = "bar"
    if "pie" in query_lower:
        chart_type = "pie"
    elif "line" in query_lower:
        chart_type = "line"
    elif "area" in query_lower:
        chart_type = "area"

    # Identify potential keys from the data structure
    sample_row = data[0]
    keys = list(sample_row.keys())

    # Find the best grouping key (dimension)
    group_key = ""
    # Look for a exact case-insensitive key name in user query
    for k in keys:
        if k.lower() in query_lower:
            group_key = k
            break

    # If no key name was mentioned in query, auto-detect the first string/category field
    if not group_key:
        for k in keys:
            val = sample_row[k]
            if isinstance(val, str) and k.lower() not in ["id", "odata_url", "invoicenumber", "salesordernumber", "ponumber", "customerid", "orderid", "productid"]:
                group_key = k
                break
    
    if not group_key:
        # Fallback to first key
        group_key = keys[0]

    # Find potential metric keys (number fields)
    metric_key = ""
    for k in keys:
        if k != group_key and isinstance(sample_row[k], (int, float)):
            # If user query mentions a metric field, choose it!
            if k.lower() in query_lower:
                metric_key = k
                break
    
    # If no numeric key is explicitly matched, let's group by counts!
    if not metric_key:
        metric_key = "count"
        # Perform group-by count aggregation
        counts = {}
        for row in data:
            val = str(row.get(group_key, "Unknown"))
            counts[val] = counts.get(val, 0) + 1
        
        chart_data = [{group_key: k, "count": v} for k, v in counts.items()]
        title = f"Count of Records by {group_key}"
    else:
        # Perform group-by sum aggregation for the numeric field
        sums = {}
        counts = {}
        for row in data:
            val = str(row.get(group_key, "Unknown"))
            try:
                num_val = float(row.get(metric_key, 0) or 0)
            except:
                num_val = 0
            sums[val] = sums.get(val, 0) + num_val
            counts[val] = counts.get(val, 0) + 1
        
        # If averaging was requested, divide sum by count
        is_average = "average" in query_lower or "avg" in query_lower
        if is_average:
            chart_data = [{group_key: k, metric_key: round(v / counts[k], 2)} for k, v in sums.items() if counts[k] > 0]
            title = f"Average {metric_key} by {group_key}"
        else:
            chart_data = [{group_key: k, metric_key: round(v, 2)} for k, v in sums.items()]
            title = f"Total {metric_key} by {group_key}"

    if not chart_data:
        return ""

    chart_json = {
        "type": "chart",
        "chartType": chart_type,
        "title": title,
        "data": chart_data,
        "xKey": group_key,
        "yKeys": [metric_key]
    }

    return f"\n\n```json\n{json.dumps(chart_json, indent=2)}\n```"


async def format_response(state: AgentState) -> dict[str, Any]:
    """Format the final response based on query_type and available data.

    Combines data_buffer, calculation_result, or direct answer into
    a polished message with proper formatting.
    """
    query_type = state.get("query_type", "direct_answer")
    data_buffer = state.get("data_buffer", [])
    calculation_result = state.get("calculation_result", "")
    final_response = state.get("final_response", "")
    generated_query = state.get("generated_query", "")
    error = state.get("error", "")
    matched_entity = state.get("matched_entity", {})
    retry_count = state.get("retry_count", 0)
    first_failed_query = state.get("first_failed_query", "")
    first_error = state.get("first_error", "")
    messages = state.get("messages", [])

    # Self-Learning Memory: Save successful correction to SurrealDB
    if retry_count > 0 and not error and first_failed_query and first_error:
        try:
            from app.services.db_client import get_db
            db = get_db()
            
            # Extract user query
            user_query = ""
            if messages:
                last = messages[-1]
                user_query = last.content if hasattr(last, "content") else str(last)
                
            # Create a rich structured exemplar that gives the AI direct procedural blueprints
            calculation_script = state.get("calculation_script", "")
            correction_text = (
                f"--- DYNAMIC SEEDED EXEMPLAR ---\n"
                f"USER QUERY: {user_query}\n\n"
                f"⚠️ WHAT NOT TO DO (PREVIOUS FAILURE):\n"
                f"Generated {query_type} query/code:\n"
                f"```\n{first_failed_query}\n```\n"
                f"FAILED WITH ERROR: {first_error}\n\n"
                f"✅ WHAT TO DO INSTEAD (WORKING BLUEPRINT):\n"
                f"Verified OData path:\n"
                f"```\n{generated_query}\n```\n"
            )
            if query_type == "calculation" and calculation_script:
                correction_text += (
                    f"Verified Python Pandas calculation script:\n"
                    f"```python\n{calculation_script}\n```\n"
                )
            correction_text += "---------------------------------"
            
            embedding = state.get("query_vector", [])
            if embedding:
                mem_record = {
                    "user_id": "default",
                    "correction": correction_text,
                    "context": f"Self-healed {query_type} correction",
                    "embedding": embedding,
                    "status": "pending"
                }
                # Fix: Use SurrealClient's create method to avoid 400 Bad Request syntax issues with Rest API SQL queries
                await db.create("agent_memory", mem_record)
                logger.info("Learned new successful correction: %s", correction_text[:120])
        except Exception as memory_err:
            logger.warning("Failed to save learned correction memory: %s", memory_err)

    # Extract user query first to check context/intent
    messages = state.get("messages", [])
    user_query = ""
    if messages:
        last = messages[-1]
        user_query = last.content if hasattr(last, "content") else str(last)

    # If there's already a final response (from direct_answer), use it
    if final_response and query_type == "direct_answer":
        return {
            "final_response": final_response,
            "messages": [AIMessage(content=final_response)],
        }

    response_parts = []

    # Check if a chart was explicitly requested by user
    has_chart_request = False
    chart_keywords = ["chart", "pie", "bar", "line", "area", "graph", "plot"]
    if any(k in user_query.lower() for k in chart_keywords):
        has_chart_request = True

    # ── OData Results ──
    if query_type == "odata" and data_buffer:
        entity_name = matched_entity.get("name", "SAP")
        response_parts.append(f"### 📊 {entity_name} — Query Results\n")
        response_parts.append(f"**Records Found:** {len(data_buffer)}\n")
        
        # Suppress raw records list when displaying visual chart configurations
        if not has_chart_request:
            response_parts.append(_format_table(data_buffer))
        else:
            response_parts.append("_Raw records omitted; displaying visualization below._")

    # ── Calculation Results ──
    elif query_type == "calculation":
        response_parts.append("### 🧮 Calculation Results\n")

        if error:
            response_parts.append(f"⚠️ **Error during execution:** {error}")
        elif calculation_result:
            # Try to parse as JSON or Python literal for structured display
            parsed = None
            try:
                parsed = json.loads(calculation_result)
            except json.JSONDecodeError:
                try:
                    import ast
                    parsed = ast.literal_eval(calculation_result)
                except:
                    pass

            if parsed is not None:
                if isinstance(parsed, dict):
                    # Check if it's a chart output JSON
                    if parsed.get("type") == "chart" and "data" in parsed:
                        title = parsed.get("title", "Chart Data")
                        response_parts.append(f"### 📊 {title}\n")
                        response_parts.append(_format_table(parsed["data"]))
                    else:
                        for key, value in parsed.items():
                            if isinstance(value, list) and value and isinstance(value[0], dict):
                                response_parts.append(f"**{key}:**\n\n" + _format_table(value))
                            else:
                                response_parts.append(f"**{key}:** {value}")
                elif isinstance(parsed, list):
                    response_parts.append(_format_table(parsed))
                else:
                    response_parts.append(str(parsed))
            else:
                response_parts.append(calculation_result)
        else:
            response_parts.append("_Calculation produced no output._")

        if data_buffer:
            response_parts.append(f"\n**Source data:** {len(data_buffer)} records processed")

    # ── Fallback ──
    if not response_parts:
        if error:
            response_parts.append(
                f"### ⚠️ Query Execution Notice\n\n"
                f"I attempted to process your request and execute the necessary queries, but encountered a persistent issue:\n\n"
                f"> **Details:** {error}\n\n"
                f"Please review your query structure or try phrasing it differently."
            )
        else:
            response_parts.append(
                "I processed your request but didn't find any relevant data. "
                "Could you rephrase your question or provide more details?"
            )

    final = "\n\n".join(response_parts)

    # Extract user query to check if a chart was requested
    messages = state.get("messages", [])
    user_query = ""
    if messages:
        last = messages[-1]
        user_query = last.content if hasattr(last, "content") else str(last)

    # Try to generate chart block and append to final response if requested
    chart_block = ""
    # Attempt to build premium chart directly from calculation_result first
    if query_type == "calculation" and calculation_result:
        try:
            parsed = None
            try:
                parsed = json.loads(calculation_result)
            except json.JSONDecodeError:
                try:
                    import ast
                    parsed = ast.literal_eval(calculation_result)
                except:
                    pass
            
            if parsed is not None:
                chart_data = []
                x_key = ""
                y_keys = []
            
            # Case 1: calculation_result is a list of dicts (e.g. [{"Country": "USA", "count": 13}])
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                chart_data = parsed
                keys = list(parsed[0].keys())
                for k in keys:
                    val = parsed[0][k]
                    is_valid_num = False
                    if isinstance(val, (int, float)) and not isinstance(val, bool):
                        import math
                        if not math.isnan(val):
                            is_valid_num = True
                    if is_valid_num and not y_keys:
                        y_keys.append(k)
                    elif not x_key:
                        x_key = k
                if not x_key and keys:
                    x_key = keys[0]
                if not y_keys and len(keys) > 1:
                    y_keys.append(keys[1])
            
            # Case 2: calculation_result is a dict
            elif isinstance(parsed, dict):
                # Subcase A: Check if the dict contains a nested list of dicts (e.g. {"customers": [{"CustomerID": "SAVEA", ...}]})
                list_of_dicts = None
                for key, value in parsed.items():
                    if isinstance(value, list) and value and isinstance(value[0], dict):
                        list_of_dicts = value
                        break
                
                if list_of_dicts:
                    chart_data = list_of_dicts
                    keys = list(list_of_dicts[0].keys())
                    for k in keys:
                        val = list_of_dicts[0][k]
                        is_valid_num = False
                        if isinstance(val, (int, float)) and not isinstance(val, bool):
                            import math
                            if not math.isnan(val):
                                is_valid_num = True
                        if is_valid_num and not y_keys:
                            y_keys.append(k)
                        elif not x_key:
                            x_key = k
                    if not x_key and keys:
                        x_key = keys[0]
                    if not y_keys and len(keys) > 1:
                        y_keys.append(keys[1])
                else:
                    # Subcase B: Original dict of arrays (e.g. {"labels": ["USA"], "values": [13]})
                    keys = list(parsed.keys())
                    if len(keys) >= 2:
                        k1, k2 = keys[0], keys[1]
                        list1 = parsed[k1]
                        list2 = parsed[k2]
                        if isinstance(list1, list) and isinstance(list2, list) and len(list1) == len(list2):
                            x_key = k1
                            y_keys = [k2]
                            if list1 and isinstance(list1[0], (int, float)) and list2 and isinstance(list2[0], str):
                                x_key = k2
                                y_keys = [k1]
                            
                            chart_data = []
                            for i in range(len(list1)):
                                chart_data.append({
                                    x_key: list1[i] if x_key == k1 else list2[i],
                                    y_keys[0]: list2[i] if x_key == k1 else list1[i]
                                })
            
            if chart_data and x_key and y_keys:
                chart_type = "bar"
                query_lower = user_query.lower()
                if "pie" in query_lower:
                    chart_type = "pie"
                elif "line" in query_lower:
                    chart_type = "line"
                elif "area" in query_lower:
                    chart_type = "area"
                
                chart_json = {
                    "type": "chart",
                    "chartType": chart_type,
                    "title": f"Calculation Output - {chart_type.capitalize()} Chart",
                    "data": chart_data,
                    "xKey": x_key,
                    "yKeys": y_keys
                }
                chart_block = f"\n\n```json\n{json.dumps(chart_json, indent=2)}\n```"
                logger.info("Generated premium chart directly from calculation_result!")
        except Exception as chart_err:
            logger.warning("Could not generate JSON chart from calculation_result: %s. Attempting dynamic regex parsing...", chart_err)
            # Fallback dynamic regex parsing for standard print formats (e.g. key1: [...], key2: [...])
            try:
                import re, ast
                lists_found = {}
                for line in calculation_result.split("\n"):
                    # Match pattern like **key**: [...] or key: [...] or key = [...]
                    match = re.search(r"^\s*(?:\*\*)?(\w+)(?:\*\*)?\s*[:=]\s*(\[[^\]]*\])", line.strip())
                    if match:
                        key_name = match.group(1).strip()
                        try:
                            parsed_list = ast.literal_eval(match.group(2).strip())
                            if isinstance(parsed_list, list):
                                lists_found[key_name] = parsed_list
                        except:
                            pass
                
                # Check if we found at least 2 lists of equal length
                keys = list(lists_found.keys())
                if len(keys) >= 2:
                    k1, k2 = keys[0], keys[1]
                    list1 = lists_found[k1]
                    list2 = lists_found[k2]
                    
                    if len(list1) == len(list2) and len(list1) > 0:
                        # Determine label (x_key) and metric (y_key) dynamically
                        x_key = k1
                        y_key = k2
                        
                        is_l1_numeric = isinstance(list1[0], (int, float))
                        is_l2_numeric = isinstance(list2[0], (int, float))
                        
                        if is_l1_numeric and not is_l2_numeric:
                            # Swap: list2 is the category/dimension (strings), list1 is the metric (numbers)
                            x_key = k2
                            y_key = k1
                        elif is_l1_numeric and is_l2_numeric:
                            # Both are numeric! Let's use heuristics to identify the dimension vs metric.
                            k1_lower = k1.lower()
                            k2_lower = k2.lower()
                            
                            dim_keywords = ['id', 'via', 'key', 'code', 'year', 'month', 'day', 'quarter', 'date', 'num', 'number']
                            metric_keywords = ['delay', 'value', 'amount', 'total', 'price', 'sum', 'avg', 'average', 'count', 'quantity', 'duration', 'diff']
                            
                            k1_dim_score = sum(1 for kw in dim_keywords if kw in k1_lower) - sum(1 for kw in metric_keywords if kw in k1_lower)
                            k2_dim_score = sum(1 for kw in dim_keywords if kw in k2_lower) - sum(1 for kw in metric_keywords if kw in k2_lower)
                            
                            if k1_dim_score < k2_dim_score:
                                # k2 has higher dimension score, so it is the category/x_key. Swap them!
                                x_key = k2
                                y_key = k1
                            elif k1_dim_score == k2_dim_score:
                                # Tie-breaker: Floats are usually metrics, integers are usually categories
                                l1_has_floats = any(isinstance(x, float) and not x.is_integer() for x in list1)
                                l2_has_floats = any(isinstance(x, float) and not x.is_integer() for x in list2)
                                if l1_has_floats and not l2_has_floats:
                                    x_key = k2
                                    y_key = k1
                            
                        chart_data = []
                        for i in range(len(list1)):
                            chart_data.append({
                                x_key: lists_found[x_key][i],
                                y_key: lists_found[y_key][i]
                            })
                            
                        chart_type = "bar"
                        query_lower = user_query.lower()
                        if "pie" in query_lower:
                            chart_type = "pie"
                        elif "line" in query_lower:
                            chart_type = "line"
                        elif "area" in query_lower:
                            chart_type = "area"
                            
                        chart_json = {
                            "type": "chart",
                            "chartType": chart_type,
                            "title": f"Calculation Output - {chart_type.capitalize()} Chart",
                            "data": chart_data,
                            "xKey": x_key,
                            "yKeys": [y_key]
                        }
                        chart_block = f"\n\n```json\n{json.dumps(chart_json, indent=2)}\n```"
                        logger.info("Generated premium chart dynamically with discovered keys: x=%s, y=%s", x_key, y_key)
            except Exception as regex_err:
                logger.warning("Could not regex-parse calculation_result: %s", regex_err)

    # Fallback to data_buffer if no chart was generated from calculation_result
    if not chart_block and data_buffer:
        chart_block = _try_generate_chart_json(data_buffer, user_query)
        if chart_block:
            try:
                # Append the small aggregated chart table in Markdown next to it
                json_str = chart_block.split("```json")[1].split("```")[0].strip()
                parsed_chart = json.loads(json_str)
                if parsed_chart.get("type") == "chart" and "data" in parsed_chart:
                    title = parsed_chart.get("title", "Chart Data")
                    table_md = f"### 📊 {title}\n\n" + _format_table(parsed_chart["data"])
                    final += "\n\n" + table_md
            except Exception as parse_err:
                logger.warning("Failed to render aggregated table for generated fallback chart: %s", parse_err)

    if chart_block:
        final += chart_block

    logger.info("Response formatted: %d characters", len(final))

    return {
        "final_response": final,
        "messages": [AIMessage(content=final)],
    }
