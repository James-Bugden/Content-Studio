'use client';

import { createContext, useContext, useState } from 'react';

export type BacklogNavigation = {
  ids: string[];
  page: number;
  totalPages: number;
  privateSearch: boolean;
  adjacent: (id: string, direction: -1 | 1) => Promise<{ id: string; page: number }>;
};

const Context = createContext<{
  navigation: BacklogNavigation | null;
  setNavigation: (navigation: BacklogNavigation | null) => void;
} | null>(null);

export function BacklogNavigationProvider({ children }: { children: React.ReactNode }) {
  const [navigation, setNavigation] = useState<BacklogNavigation | null>(null);
  return <Context.Provider value={{ navigation, setNavigation }}>{children}</Context.Provider>;
}

export function useBacklogNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error('Backlog navigation provider is missing');
  return context;
}
