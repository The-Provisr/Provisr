import type { ComponentType as ReactComponentType } from "react";
import type { ZodType } from "zod";
import type { ComponentType } from "@provisr/shared-contracts";

export type MigrateFn<T> = (data: unknown, fromVersion: string) => T;

export interface RegistryEntry<T = unknown> {
  type: string;
  version: string;
  schema: ZodType<T, any, any>;
  component: ReactComponentType<{ data: T }>;
  migrate?: MigrateFn<T>;
}

export type RegisterInput<T> = RegistryEntry<T> & {
  type: ComponentType | (string & {});
};

export interface ComponentRegistry {
  register<T>(input: RegisterInput<T>): void;
  get(type: string): RegistryEntry<unknown> | undefined;
  has(type: string): boolean;
}

export function createRegistry(): ComponentRegistry {
  const entries = new Map<string, RegistryEntry<unknown>>();
  return {
    register(input) {
      if (entries.has(input.type)) {
        throw new Error(`Component type "${input.type}" is already registered.`);
      }
      entries.set(input.type, input as RegistryEntry<unknown>);
    },
    get: (type) => entries.get(type),
    has: (type) => entries.has(type),
  };
}

export const defaultRegistry = createRegistry();
