import { analyzeSQL } from "@/lib/sqlAnalyzer";
import type { ParsedReviewContext } from "@/types/review-context";
import type { SqlFinding } from "@/types/sql-review";

type Fixture = {
  name: string;
  query: string;
  context?: ParsedReviewContext;
  expect: (findings: SqlFinding[]) => boolean;
};

const sampleSchemaContext: ParsedReviewContext = {
  source: "pasted_json",
  schema: {
    tables: {
      orders: {
        grain: "one row per order",
        columns: {
          order_id: { type: "string", nullable: false, unique: true },
          user_id: { type: "string", nullable: false, unique: false },
          revenue: { type: "decimal", nullable: true },
        },
      },
      payments: {
        grain: "one row per payment",
        columns: {
          payment_id: { type: "string", nullable: false, unique: true },
          order_id: { type: "string", nullable: false },
          user_id: { type: "string", nullable: false, unique: false },
        },
      },
    },
  },
};

export const sqlAnalyzerFixtures: Fixture[] = [
  {
    name: "A. Division by zero",
    query: `
      SELECT revenue / orders AS avg_order_value
      FROM daily_kpis;
    `,
    expect: (findings) =>
      findings.some((finding) => finding.title.includes("division-by-zero")),
  },
  {
    name: "B. Join duplication risk",
    query: `
      SELECT
        o.user_id,
        o.order_id,
        p.payment_id
      FROM orders o
      JOIN payments p
        ON o.user_id = p.user_id;
    `,
    expect: (findings) =>
      findings.some((finding) => finding.title.includes("Potential join duplication risk")),
  },
  {
    name: "C. Null handling",
    query: `
      SELECT SUM(discount_amount) / SUM(gross_amount) AS discount_rate
      FROM line_items;
    `,
    expect: (findings) =>
      findings.some((finding) =>
        finding.title.includes("Potential null impact in aggregate arithmetic"),
      ),
  },
  {
    name: "D. True grain mismatch",
    query: `
      SELECT
        region,
        product_id,
        SUM(revenue) AS revenue
      FROM sales
      GROUP BY region;
    `,
    expect: (findings) =>
      findings.some((finding) => finding.title.includes("grain mismatch")),
  },
  {
    name: "F. Valid grouped ratio should not trigger grain mismatch",
    query: `
      SELECT
          user_id,
          SUM(revenue) / COUNT(order_id) AS avg_order_value
      FROM orders
      GROUP BY user_id;
    `,
    expect: (findings) =>
      !findings.some((finding) => finding.title.includes("grain mismatch")),
  },
  {
    name: "G. Valid grouped sum should not trigger grain mismatch",
    query: `
      SELECT
          user_id,
          SUM(discount) AS total_discount
      FROM orders
      GROUP BY user_id;
    `,
    expect: (findings) =>
      !findings.some((finding) => finding.title.includes("grain mismatch")),
  },
  {
    name: "H. Valid grouped ratio with NULLIF should not trigger grain mismatch",
    query: `
      SELECT
          user_id,
          SUM(revenue) / NULLIF(COUNT(order_id), 0) AS avg_order_value
      FROM orders
      GROUP BY user_id;
    `,
    expect: (findings) =>
      !findings.some((finding) => finding.title.includes("grain mismatch")),
  },
  {
    name: "I. Missing grouped field should trigger grain mismatch",
    query: `
      SELECT
          user_id,
          order_id,
          SUM(revenue)
      FROM orders
      GROUP BY user_id;
    `,
    expect: (findings) =>
      findings.some((finding) => finding.title.includes("grain mismatch")),
  },
  {
    name: "E. Clean safe query",
    query: `
      SELECT
        o.order_id,
        SUM(COALESCE(li.amount, 0)) / NULLIF(COUNT(DISTINCT li.line_id), 0) AS avg_line_amount
      FROM orders o
      JOIN line_items li
        ON o.order_id = li.order_id
      GROUP BY o.order_id;
    `,
    expect: (findings) => findings.length === 0,
  },
  {
    name: "J. Context-aware join should become specific",
    query: `
      SELECT 
          o.user_id,
          o.order_id,
          p.payment_id
      FROM orders o
      JOIN payments p
          ON o.user_id = p.user_id;
    `,
    context: sampleSchemaContext,
    expect: (findings) =>
      findings.some(
        (finding) =>
          finding.title.includes("Likely row multiplication") &&
          finding.contextUsed === true,
      ),
  },
  {
    name: "K. Context-aware grain mismatch should reference grain",
    query: `
      SELECT
          user_id,
          order_id,
          SUM(revenue)
      FROM orders
      GROUP BY user_id;
    `,
    context: sampleSchemaContext,
    expect: (findings) =>
      findings.some(
        (finding) =>
          finding.title.includes("grain mismatch") &&
          (finding.description.includes("output grain") ||
            finding.recommendation.includes("Declared table grain")),
      ),
  },
];

export function runSqlAnalyzerFixtures() {
  const failures: string[] = [];
  for (const fixture of sqlAnalyzerFixtures) {
    const findings = analyzeSQL(fixture.query, fixture.context);
    if (!fixture.expect(findings)) {
      failures.push(`${fixture.name} failed. Findings: ${JSON.stringify(findings)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`SQL analyzer fixtures failed:\n${failures.join("\n")}`);
  }

  return { passed: sqlAnalyzerFixtures.length };
}
