"use client";

import "./components";
import { createContext, useMemo, type ReactNode } from "react";
import { defaultRegistry, type ComponentRegistry } from "./registry";

export const RegistryContext = createContext<ComponentRegistry | null>(null);

export function RegistryProvider({
  children,
  registry = defaultRegistry,
}: {
  children: ReactNode;
  registry?: ComponentRegistry;
}) {
  const value = useMemo(() => registry, [registry]);
  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}
