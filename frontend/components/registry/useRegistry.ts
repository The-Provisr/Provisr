"use client";

import { useContext } from "react";
import { RegistryContext } from "./RegistryProvider";

export function useRegistry() {
  const ctx = useContext(RegistryContext);
  if (!ctx) {
    throw new Error("useRegistry must be used within a <RegistryProvider>.");
  }
  return ctx;
}
