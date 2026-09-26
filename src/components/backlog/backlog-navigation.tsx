'use client';

import { createContext, useContext, useState } from 'react';
import type { LibraryRecord } from '@/domain/records';
import type { BacklogReadiness } from '@/domain/library-backlog';

export type BacklogResult = {
  ok: true;
  rows: Pick<LibraryRecord, 'row' | 'value'>[];
  statuses: Record<string, BacklogReadiness>;
  total: number;
  page: number;
  totalPages: number;
};

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
  search: string;
  setSearch: (search: string) => void;
  searchPage: number;
  setSearchPage: (page: number) => void;
  result: { key: string; data: BacklogResult } | null;
  setResult: (result: { key: string; data: BacklogResult } | null) => void;
} | null>(null);

export function BacklogNavigationProvider({ children }: { children: React.ReactNode }) {
  const [navigation, setNavigation] = useState<BacklogNavigation | null>(null);
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [result, setResult] = useState<{ key: string; data: BacklogResult } | null>(null);
  return <Context.Provider value={{ navigation, setNavigation, search, setSearch, searchPage, setSearchPage, result, setResult }}>{children}</Context.Provider>;
}

export function useBacklogNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error('Backlog navigation provider is missing');
  return context;
}
