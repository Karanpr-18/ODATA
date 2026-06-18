"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "@/components/sidebar";
import { ChatArea } from "@/components/chat-area";
import { SettingsView } from "@/components/settings-view";
import { DiscoveryView } from "@/components/discovery-view";
import { JoinView } from "@/components/join-view";
import { fetchThreads, createThread, deleteThread, renameThread, fetchThreadMessages, fetchSettings, ServiceConfig, JoinedServiceConfig, MCPConfig } from "@/lib/api";
import { Thread, Message, MODELS } from "@/lib/types";

type AppView =
  | { type: "chat" }
  | { type: "settings" }
  | { type: "discovery"; service?: ServiceConfig; mcp?: MCPConfig }
  | { type: "join" };

export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>({ type: "chat" });

  // Track services for join view
  const [services, setServices] = useState<(ServiceConfig | JoinedServiceConfig)[]>([]);

  // Skip loading messages from DB for newly created threads to prevent wiping state
  const shouldSkipLoadRef = useRef(false);

  // Sync active model from database settings
  const syncModelFromSettings = useCallback(async () => {
    try {
      const settings = await fetchSettings();
      if (settings && settings.llm && settings.llm.active_model) {
        setSelectedModel(settings.llm.active_model);
      }
      if (settings && settings.services) {
        setServices(settings.services);
      }
    } catch (err) {
      console.error("Failed to sync model from settings:", err);
    }
  }, []);

  // Load threads and settings on mount and when views switch
  useEffect(() => {
    loadThreads();
  }, []);

  useEffect(() => {
    syncModelFromSettings();
  }, [currentView, syncModelFromSettings]);

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
      // Switch to chat view if in settings
      setCurrentView({ type: "chat" });
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
    // Switch to chat view when selecting a thread
    setCurrentView({ type: "chat" });
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

  const handleJoinedServiceCreated = useCallback((newService: JoinedServiceConfig) => {
    setServices((prev) => [...prev, newService]);
  }, []);

  /* Render the active view */
  const renderView = () => {
    switch (currentView.type) {
      case "settings":
        return (
          <SettingsView
            onBack={() => setCurrentView({ type: "chat" })}
            onNavigateToDiscovery={(params) =>
              setCurrentView({ type: "discovery", ...params })
            }
            onNavigateToJoin={() => setCurrentView({ type: "join" })}
          />
        );
      case "discovery":
        return (
          <DiscoveryView
            service={currentView.service}
            mcp={currentView.mcp}
            onBack={() => setCurrentView({ type: "settings" })}
          />
        );
      case "join":
        return (
          <JoinView
            services={services}
            onBack={() => setCurrentView({ type: "settings" })}
            onServiceCreated={handleJoinedServiceCreated}
          />
        );
      case "chat":
      default:
        return (
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
        );
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar
        threads={threads}
        activeThreadId={activeThreadId}
        isLoading={isLoadingThreads}
        isOpen={sidebarOpen}
        onNewChat={handleNewChat}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onOpenSettings={() => setCurrentView({ type: "settings" })}
      />
      {renderView()}
    </div>
  );
}
