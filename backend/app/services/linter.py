"""
Linter Service — Performs static validation on generated OData queries and Python sandbox scripts.
Ensures that fields, entities, and attributes match the active metadata schemas, and checks
for syntax errors and security policy violations before executing queries.
"""

import ast
import json
import logging
import re
import urllib.parse
from typing import Any

logger = logging.getLogger(__name__)


class ColumnAccessVisitor(ast.NodeVisitor):
    """AST visitor to extract dataframe columns accessed or created in a Python script."""

    def __init__(self):
        self.accessed_columns = set()
        self.created_columns = set()

    def visit_Subscript(self, node):
        # Handles df['column_name'] or df[['col1', 'col2']]
        if isinstance(node.value, ast.Name) and node.value.id in ('df', 'data_df', 'dataframe'):
            slice_node = node.slice
            if isinstance(slice_node, ast.Constant) and isinstance(slice_node.value, str):
                self.accessed_columns.add(slice_node.value)
            elif isinstance(slice_node, ast.List):
                for elt in slice_node.elts:
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                        self.accessed_columns.add(elt.value)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        # Handles df.column_name
        if isinstance(node.value, ast.Name) and node.value.id in ('df', 'data_df', 'dataframe'):
            # Ignore standard pandas DataFrame attributes/methods
            df_methods = {
                'groupby', 'sort_values', 'drop', 'dropna', 'sum', 'mean', 'count', 
                'head', 'tail', 'describe', 'info', 'merge', 'join', 'concat', 
                'reset_index', 'set_index', 'rename', 'apply', 'map', 'astype', 
                'fillna', 'columns', 'index', 'values', 'loc', 'iloc', 'plot',
                'to_json', 'to_dict', 'to_csv', 'value_counts', 'unique', 'nunique',
                'empty', 'shape', 'size', 'dtypes', 'T'
            }
            if node.attr not in df_methods:
                self.accessed_columns.add(node.attr)
        self.generic_visit(node)

    def visit_Assign(self, node):
        # Check if columns are created, e.g. df['new_col'] = ...
        for target in node.targets:
            if isinstance(target, ast.Subscript):
                if isinstance(target.value, ast.Name) and target.value.id in ('df', 'data_df', 'dataframe'):
                    slice_node = target.slice
                    if isinstance(slice_node, ast.Constant) and isinstance(slice_node.value, str):
                        self.created_columns.add(slice_node.value)
                    elif isinstance(slice_node, ast.List):
                        for elt in slice_node.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                self.created_columns.add(elt.value)
        self.generic_visit(node)

    def visit_Call(self, node):
        # Handles df.groupby('col') or df.groupby(['col1', 'col2'])
        if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id in ('df', 'data_df', 'dataframe'):
            method_name = node.func.attr
            if method_name in ('groupby', 'sort_values', 'drop', 'dropna'):
                for arg in node.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        self.accessed_columns.add(arg.value)
                    elif isinstance(arg, ast.List):
                        for elt in arg.elts:
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                self.accessed_columns.add(elt.value)
                for kw in node.keywords:
                    if kw.arg in ('by', 'columns', 'on', 'left_on', 'right_on'):
                        if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                            self.accessed_columns.add(kw.value.value)
                        elif isinstance(kw.value, ast.List):
                            for elt in kw.value.elts:
                                if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                    self.accessed_columns.add(elt.value)
        self.generic_visit(node)


def validate_odata_query(query: str, matched_entity: dict[str, Any]) -> str | None:
    """Validate that the generated OData path and parameters conform to the entity metadata schema.

    Returns:
        Error message string if linting fails, otherwise None.
    """
    if not query:
        return "Query is empty"
    if not matched_entity:
        return "No matched entity context available for validation"

    path_part = query
    query_part = ""
    if "?" in query:
        parts = query.split("?", 1)
        path_part = parts[0]
        query_part = parts[1]

    expected_set = matched_entity.get("entity_set", "")
    actual_set = path_part.lstrip("/")

    if not actual_set:
        return "OData query path is empty"

    # Strip OData key selectors like /Customers(CustomerID='ALFKI') or /Customers('ALFKI')
    if "(" in actual_set:
        actual_set = actual_set.split("(", 1)[0]

    # Verify matching base path
    if actual_set.upper() != expected_set.upper():
        nav_props = matched_entity.get("nav_properties", [])
        set_parts = [p for p in actual_set.split("/") if p]
        if set_parts:
            base_set = set_parts[0]
            if "(" in base_set:
                base_set = base_set.split("(", 1)[0]
            if base_set.upper() != expected_set.upper():
                return f"OData entity set '{base_set}' does not match expected target entity set '{expected_set}'"

            # Check remaining path segments as navigation property expansions
            for sub_path in set_parts[1:]:
                if "(" in sub_path:
                    sub_path = sub_path.split("(", 1)[0]
                if sub_path not in nav_props:
                    return f"Invalid navigation path segment '{sub_path}' in OData path. Valid nav properties: {nav_props}"

    # Load properties and nav properties
    schema_str = matched_entity.get("metadata_schema", "{}")
    properties = {}
    try:
        schema = json.loads(schema_str)
        properties = schema.get("properties", {})
    except Exception as e:
        logger.warning("Failed to parse metadata_schema in OData linter: %s", e)

    valid_fields = set(properties.keys())
    valid_nav = set(matched_entity.get("nav_properties", []))

    # Parse query string parameters
    params = urllib.parse.parse_qsl(query_part)
    params_dict = {k.strip(): v.strip() for k, v in params}

    # Validate $select fields
    if "$select" in params_dict:
        select_val = params_dict["$select"]
        select_fields = [f.strip() for f in select_val.split(",") if f.strip()]
        for field in select_fields:
            if "/" in field:
                parts = field.split("/")
                prefix = parts[0]
                if prefix not in valid_nav and prefix not in valid_fields:
                    return f"Invalid select path prefix '{prefix}' in '{field}'. Valid properties: {list(valid_fields)}, nav properties: {list(valid_nav)}"
                continue

            if field not in valid_fields and field not in valid_nav:
                return f"Field '{field}' in $select is not a valid property of '{expected_set}'. Available fields: {list(valid_fields)}"

    # Validate $filter fields
    if "$filter" in params_dict:
        filter_val = params_dict["$filter"]
        # Strip string literals to avoid matching text inside quotes as properties
        filter_no_strings = re.sub(r"'[^']*'", "", filter_val)
        tokens = re.findall(r"\b[A-Za-z_][A-Za-z0-9_/]*\b", filter_no_strings)

        odata_keywords = {
            "eq", "ne", "gt", "ge", "lt", "le", "and", "or", "not", "null", "true", "false",
            "startswith", "endswith", "contains", "substringof", "datetime", "guid", "day",
            "month", "year", "hour", "minute", "second", "tolower", "toupper", "trim",
            "concat", "length", "indexof", "replace", "substring", "round", "floor", "ceiling"
        }

        for token in tokens:
            if token.lower() in odata_keywords:
                continue

            if "/" in token:
                parts = token.split("/")
                prefix = parts[0]
                if prefix not in valid_nav and prefix not in valid_fields:
                    return f"Invalid filter path prefix '{prefix}' in '{token}'. Valid properties: {list(valid_fields)}, nav properties: {list(valid_nav)}"
                continue

            if token not in valid_fields and token not in valid_nav:
                return f"Field '{token}' in $filter is not a valid property of '{expected_set}'. Available fields: {list(valid_fields)}"

    return None


def validate_python_script(code: str, matched_entity: dict[str, Any]) -> str | None:
    """Statically compile the script, check syntax, security modules, and schema access safety.

    Returns:
        Error message string if linting fails, otherwise None.
    """
    if not code:
        return "Script code is empty"

    # 1. Parse AST to check syntax
    try:
        root = ast.parse(code)
    except SyntaxError as syntax_err:
        return f"Python syntax error: {syntax_err.msg} at line {syntax_err.lineno}, col {syntax_err.offset}"

    # 2. Check for banned imports
    banned_modules = {"os", "subprocess", "shutil", "socket", "urllib", "requests", "httpx"}
    for node in ast.walk(root):
        if isinstance(node, ast.Import):
            for name in node.names:
                module_base = name.name.split(".")[0]
                if module_base in banned_modules:
                    return f"Security Violation: Import of module '{module_base}' is banned in calculation sandbox"
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                module_base = node.module.split(".")[0]
                if module_base in banned_modules:
                    return f"Security Violation: Import from module '{module_base}' is banned in calculation sandbox"

    # 3. Check for dataframe schema access validation
    schema_str = matched_entity.get("metadata_schema", "{}") if matched_entity else "{}"
    properties = {}
    try:
        schema = json.loads(schema_str)
        properties = schema.get("properties", {})
    except Exception as e:
        logger.warning("Failed to parse metadata_schema in Python linter: %s", e)

    valid_columns = set(properties.keys())
    valid_nav = set(matched_entity.get("nav_properties", [])) if matched_entity else set()

    visitor = ColumnAccessVisitor()
    visitor.visit(root)

    # Accessed columns that were not created/assigned inside the python script itself
    unchecked_columns = visitor.accessed_columns - visitor.created_columns

    for col in unchecked_columns:
        # Skip generic system indices/labels
        if col in ("index", "level_0", "level_1", "0", 0, "value", "data"):
            continue

        if col in valid_columns or col in valid_nav:
            continue

        # Check navigation prefix mappings (flattened expand fields like Customer.CompanyName, Customer_CompanyName, Customer/CompanyName)
        has_valid_prefix = False
        for nav in valid_nav:
            if col.startswith(f"{nav}.") or col.startswith(f"{nav}_") or col.startswith(f"{nav}/"):
                has_valid_prefix = True
                break

        if has_valid_prefix:
            continue

        expected_set = matched_entity.get("entity_set", "SAP") if matched_entity else "entity"
        return f"Column '{col}' accessed in script does not exist in entity '{expected_set}'. Available columns: {list(valid_columns)}"

    return None
