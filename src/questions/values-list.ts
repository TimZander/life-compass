/**
 * Values starter list — a reference page, with room for the reader's own words.
 *
 * The list itself is prose and stays prose. Only the three additions at the foot of it
 * are answers, and they are the smallest question set in the workbook.
 */

import type { Question } from "./types.ts";

export const VALUES_LIST: readonly Question[] = [
  {
    kind: "repeat",
    id: "values.additions",
    instances: "row",
    label: "Value",
    min: 3,
    max: 3,
    fields: [{ id: "value", label: "Value", size: "long" }],
  },
];
