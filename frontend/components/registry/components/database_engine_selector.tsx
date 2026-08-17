import { z } from "zod";
import { defaultRegistry } from "../registry";

export const databaseEngineSelectorSchema = z.object({
  recommendedEngine: z.string(),
  reasoning: z.string(),
  availableEngines: z.array(
    z.object({
      engine: z.string(),
      displayName: z.string(),
      bestFor: z.string(),
      isRecommended: z.boolean().optional(),
    }),
  ),
  selectedEngine: z.string().optional(),
});

export type DatabaseEngineSelectorData = z.infer<typeof databaseEngineSelectorSchema>;

export function DatabaseEngineSelectorComponent({
  data,
}: {
  data: DatabaseEngineSelectorData;
}) {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/20 p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
          Engine Recommendation (AG-012A)
        </span>
      </div>

      <h3 className="mt-2 text-base font-semibold text-gray-900">
        Recommended: <span className="capitalize text-amber-700">{data.recommendedEngine}</span>
      </h3>
      <p className="mt-1 text-xs text-gray-600 leading-relaxed">{data.reasoning}</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.availableEngines.map((eng) => (
          <div
            key={eng.engine}
            className={`rounded-lg border p-3 text-xs transition-colors ${
              eng.engine === data.recommendedEngine || eng.isRecommended
                ? "border-amber-400 bg-amber-50/60"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">{eng.displayName}</span>
              {eng.isRecommended || eng.engine === data.recommendedEngine ? (
                <span className="text-[10px] font-bold uppercase text-amber-700">★ Recommended</span>
              ) : null}
            </div>
            <p className="mt-1 text-gray-500">{eng.bestFor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "database_engine_selector",
  version: "1.0",
  schema: databaseEngineSelectorSchema,
  component: DatabaseEngineSelectorComponent,
});
