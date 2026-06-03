"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { GraphExplorer } from "@/components/graph-explorer";
import { fetchThreads, createThread, deleteThread, renameThread, fetchThreadMessages } from "@/lib/api";
import { Thread, Message, MODELS } from "@/lib/types";

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<"chat" | "graph">("chat");

  // Skip loading messages from DB for newly created threads to prevent wiping state
  const shouldSkipLoadRef = useRef(false);

  // Load threads on mount
  useEffect(() => {
    loadThreads();
  }, []);

  // Load messages when active thread changes
  useEffect(() => {
    if (activeThreadId) {
      if (shouldSkipLoadRef.current) {
        shouldSkipLoadRef.current = false;
        return;
      }
      loadMessages(activeThreadId);
    } else {
      setMessages([]);
    }
  }, [activeThreadId]);

  const loadThreads = async () => {
    setIsLoadingThreads(true);
    const data = await fetchThreads();
    setThreads(data);
    setIsLoadingThreads(false);
  };

  const loadMessages = async (threadId: string) => {
    const data = await fetchThreadMessages(threadId);
    setMessages(data);
  };

  const handleNewChat = useCallback(async () => {
    const thread = await createThread("New Chat");
    if (thread) {
      shouldSkipLoadRef.current = true;
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
      setMessages([]);
    }
  }, []);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    const success = await deleteThread(threadId);
    if (success) {
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
      }
    }
  }, [activeThreadId]);

  const handleRenameThread = useCallback(async (threadId: string, newTitle: string) => {
    const success = await renameThread(threadId, newTitle);
    if (success) {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title: newTitle } : t))
      );
    }
  }, []);

  const handleSelectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
  }, []);

  const handleThreadCreated = useCallback((thread: Thread) => {
    shouldSkipLoadRef.current = true;
    setThreads((prev) => {
      const exists = prev.some((t) => t.id === thread.id);
      if (exists) return prev;
      return [thread, ...prev];
    });
    setActiveThreadId(thread.id);
  }, []);

  const handleUpdateThreadTitle = useCallback((threadId: string, title: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title } : t))
    );
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        threads={threads}
        activeThreadId={activeThreadId}
        selectedModel={selectedModel}
        isLoading={isLoadingThreads}
        isOpen={sidebarOpen}
        currentView={currentView}
        onViewChange={(view) => {
          setCurrentView(view);
          // If switching to graph view, we can keep the sidebar intact but change right-side rendering
        }}
        onNewChat={handleNewChat}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        onModelChange={setSelectedModel}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      {currentView === "chat" ? (
        <ChatArea
          messages={messages}
          setMessages={setMessages}
          activeThreadId={activeThreadId}
          selectedModel={selectedModel}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onThreadCreated={handleThreadCreated}
          onUpdateThreadTitle={handleUpdateThreadTitle}
        />
      ) : (
        <GraphExplorer />
      )}
    </div>
  );
}
