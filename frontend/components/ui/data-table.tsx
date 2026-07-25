const rows = [
  {
    size: "Startup (1-50 Employees)",
    opportunities: [
      "Flexible roles across various functions (Marketing, Sales, Product).",
      "Equity or stock ownership",
      "Rapid career growth opportunities",
    ],
  },
  {
    size: "Small Business (51-200 Employees)",
    opportunities: [
      "Roles with greater responsibility compared to larger companies",
      "Opportunity to shape business strategies",
      "Faster career advancement potential",
    ],
  },
  {
    size: "Mid-Sized Company (201-1000 Employees)",
    opportunities: [
      "More stable structure with room for innovation",
      "Access to better resources and mentorship",
      "Higher job security compared to startups",
    ],
  },
];

export function OpportunitiesTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="w-1/3 border-b border-gray-100 px-6 py-4 font-semibold">
              Company Size
            </th>
            <th className="border-b border-gray-100 px-6 py-4 font-semibold">
              Best Opportunities
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-700">
          {rows.map((row) => (
            <tr key={row.size}>
              <td className="align-top px-6 py-6 font-medium">{row.size}</td>
              <td className="px-6 py-6">
                <ul className="space-y-2">
                  {row.opportunities.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
