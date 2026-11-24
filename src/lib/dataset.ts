import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";

export type CellValue = string | number | boolean | null;
export type DataRow = Record<string, CellValue>;
export type ColumnType = "number" | "boolean" | "date" | "string" | "mixed";

export interface Dataset {
  name: string;
  columns: string[];
  rows: DataRow[];
  types: Record<string, ColumnType>;
}

export interface ColumnStats {
  name: string;
  type: ColumnType;
  count: number;
  missing: number;
  unique: number;
  min: number | string | null;
  max: number | string | null;
  mean: number | null;
  top: { value: string; count: number }[];
}

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "notEmpty";

export type FillStrategy = "mean" | "median" | "mode" | "custom";
export type NormalizeMethod = "minmax" | "zscore";

const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".json", ".jsonl", ".ndjson", ".xlsx", ".xlsm"];

export function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function normalizeCell(value: unknown): CellValue {
  if (isMissing(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, index) => {
    const base = (String(raw ?? "").trim() || `colonne_${index + 1}`).replace(/\s+/g, "_");
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return name;
  });
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, 5000)) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function inferType(values: CellValue[]): ColumnType {
  const present = values.filter((value) => !isMissing(value));
  if (present.length === 0) return "string";
  if (present.every((value) => typeof value === "number")) return "number";
  if (
    present.every(
      (value) =>
        typeof value === "boolean" ||
        (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())),
    )
  ) {
    return "boolean";
  }
  if (present.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value))) {
    return "date";
  }
  if (present.every((value) => typeof value === "string")) return "string";
  return "mixed";
}

function refreshTypes(dataset: Dataset): Dataset {
  const types: Record<string, ColumnType> = {};
  for (const column of dataset.columns) {
    types[column] = inferType(dataset.rows.map((row) => row[column] ?? null));
  }
  return { ...dataset, types };
}

export function buildDataset(name: string, columns: string[], rawRows: Record<string, unknown>[]): Dataset {
  const safeColumns = uniqueNames(columns);
  const rows = rawRows.map((raw) => {
    const row: DataRow = {};
    for (const column of safeColumns) {
      row[column] = normalizeCell(raw[column]);
    }
    return row;
  });
  return refreshTypes({ name, columns: safeColumns, rows, types: {} });
}

function parseCsv(file: File): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(results.errors[0].message));
          return;
        }
        resolve(buildDataset(file.name, results.meta.fields ?? [], results.data));
      },
      error: (error) => reject(error),
    });
  });
}

function rowsFromTable(firstRow: unknown[], restRows: unknown[][]): { columns: string[]; rows: Record<string, unknown>[] } {
  if (firstRow.length === 0) throw new Error("La feuille ne contient pas d'en-têtes.");
  const columns = firstRow.map((cell, index) => String(normalizeCell(cell) ?? `colonne_${index + 1}`));
  const rows = restRows.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      row[column] = values[index] ?? null;
    });
    return row;
  });
  return { columns, rows };
}

async function parseExcel(file: File): Promise<Dataset> {
  const sheet = await readSheet(file);
  if (sheet.length === 0) throw new Error("Le fichier Excel est vide.");
  const { columns, rows } = rowsFromTable(sheet[0], sheet.slice(1));
  return buildDataset(file.name, columns, rows);
}

function objectListToDataset(name: string, rows: Record<string, unknown>[]): Dataset {
  return buildDataset(name, collectColumns(rows), rows);
}

async function parseJson(file: File): Promise<Dataset> {
  const parsed: unknown = JSON.parse(await file.text());
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && Array.isArray(parsed[0])) {
      const table = rowsFromTable(parsed[0], parsed.slice(1) as unknown[][]);
      return buildDataset(file.name, table.columns, table.rows);
    }
    return objectListToDataset(file.name, parsed as Record<string, unknown>[]);
  }
  if (parsed && typeof parsed === "object") {
    const container = parsed as Record<string, unknown>;
    for (const key of ["data", "rows", "records", "values", "items"]) {
      if (Array.isArray(container[key])) {
        return objectListToDataset(file.name, container[key] as Record<string, unknown>[]);
      }
    }
    return objectListToDataset(file.name, [container]);
  }
  throw new Error("Le fichier JSON doit contenir un objet ou une liste d'objets.");
}

async function parseJsonLines(file: File): Promise<Dataset> {
  const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim() !== "");
  const rows = lines.map((line, index) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`Ligne ${index + 1} invalide.`);
    }
  });
  return objectListToDataset(file.name, rows);
}

export async function parseDatasetFile(file: File): Promise<Dataset> {
  if (!isSupportedFile(file)) {
    throw new Error("Format non pris en charge. Utilisez CSV, TSV, XLSX, JSON ou JSONL.");
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return parseExcel(file);
  if (name.endsWith(".jsonl") || name.endsWith(".ndjson")) return parseJsonLines(file);
  if (name.endsWith(".json")) return parseJson(file);
  return parseCsv(file);
}

export function mergeDatasets(datasets: Dataset[], name: string): Dataset {
  if (datasets.length === 0) throw new Error("Aucun fichier à fusionner.");
  if (datasets.length === 1) return { ...datasets[0], name };
  const columns = uniqueNames(datasets.flatMap((item) => item.columns));
  const rows = datasets.flatMap((item) =>
    item.rows.map((row) => {
      const next: DataRow = {};
      for (const column of columns) next[column] = row[column] ?? null;
      return next;
    }),
  );
  return refreshTypes({ name, columns, rows, types: {} });
}

export function computeStats(dataset: Dataset): ColumnStats[] {
  return dataset.columns.map((name) => {
    const values = dataset.rows.map((row) => row[name] ?? null);
    const present = values.filter((value) => !isMissing(value));
    const numbers = present.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const counts = new Map<string, number>();
    for (const value of present) {
      const key = String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 5);
    const dateStrings = present.map(String).filter((value) => /^\d{4}-\d{2}-\d{2}/.test(value)).sort();

    return {
      name,
      type: dataset.types[name] ?? "string",
      count: present.length,
      missing: values.length - present.length,
      unique: counts.size,
      min: numbers.length > 0 ? Math.min(...numbers) : dateStrings[0] ?? null,
      max: numbers.length > 0 ? Math.max(...numbers) : dateStrings[dateStrings.length - 1] ?? null,
      mean: numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null,
      top,
    };
  });
}

function withRows(dataset: Dataset, rows: DataRow[], refresh = false): Dataset {
  return refresh ? refreshTypes({ ...dataset, rows }) : { ...dataset, rows };
}

export function dropColumns(dataset: Dataset, columns: string[]): Dataset {
  const removed = new Set(columns);
  const kept = dataset.columns.filter((column) => !removed.has(column));
  if (kept.length === 0) throw new Error("Un dataset doit garder au moins une colonne.");
  const rows = dataset.rows.map((row) => {
    const next: DataRow = {};
    for (const column of kept) next[column] = row[column] ?? null;
    return next;
  });
  return refreshTypes({ ...dataset, columns: kept, rows });
}

export function renameColumn(dataset: Dataset, column: string, nextName: string): Dataset {
  const name = nextName.trim().replace(/\s+/g, "_");
  if (!name) throw new Error("Le nouveau nom est vide.");
  if (name !== column && dataset.columns.includes(name)) throw new Error("Ce nom de colonne existe déjà.");
  const columns = dataset.columns.map((item) => (item === column ? name : item));
  const rows = dataset.rows.map((row) => {
    const next: DataRow = {};
    for (const item of dataset.columns) next[item === column ? name : item] = row[item] ?? null;
    return next;
  });
  return { ...dataset, columns, rows, types: Object.fromEntries(Object.entries(dataset.types).map(([key, value]) => [key === column ? name : key, value])) };
}

export function dropMissingRows(dataset: Dataset, columns: string[]): Dataset {
  const selected = columns.length > 0 ? columns : dataset.columns;
  return withRows(
    dataset,
    dataset.rows.filter((row) => selected.every((column) => !isMissing(row[column]))),
  );
}

export function dropDuplicates(dataset: Dataset): Dataset {
  const seen = new Set<string>();
  const rows = dataset.rows.filter((row) => {
    const key = dataset.columns.map((column) => JSON.stringify(row[column] ?? null)).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return withRows(dataset, rows);
}

function numericValues(dataset: Dataset, column: string): number[] {
  return dataset.rows
    .map((row) => row[column])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function fillMissing(dataset: Dataset, column: string, strategy: FillStrategy, custom?: string): Dataset {
  const present = dataset.rows.map((row) => row[column]).filter((value) => !isMissing(value));
  const numbers = numericValues(dataset, column);
  const counts = new Map<string, number>();
  for (const value of present) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mean = numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
  let replacement: CellValue = null;
  if (strategy === "custom") replacement = custom !== undefined && custom.trim() !== "" ? custom.trim() : null;
  else if (strategy === "mode") replacement = mode ?? null;
  else if (strategy === "mean") replacement = mean;
  else if (strategy === "median") replacement = numbers.length > 0 ? median(numbers) : null;
  if (replacement === null) throw new Error("Aucune valeur disponible pour combler les manquants.");

  const shouldCast = typeof replacement === "string" && dataset.types[column] === "number" && Number.isFinite(Number(replacement));
  const value: CellValue = shouldCast ? Number(replacement) : replacement;
  const rows = dataset.rows.map((row) => (isMissing(row[column]) ? { ...row, [column]: value } : row));
  return refreshTypes({ ...dataset, rows });
}

export function filterRows(dataset: Dataset, column: string, operator: FilterOperator, input: string): Dataset {
  const needle = input.trim();
  const typed = Number(needle);
  const isNumeric = needle !== "" && Number.isFinite(typed);
  const rows = dataset.rows.filter((row) => {
    const value = row[column] ?? null;
    const text = value === null ? "" : String(value);
    switch (operator) {
      case "empty":
        return isMissing(value);
      case "notEmpty":
        return !isMissing(value);
      case "equals":
        return isNumeric ? value === typed : text.toLowerCase() === needle.toLowerCase();
      case "notEquals":
        return isNumeric ? value !== typed : text.toLowerCase() !== needle.toLowerCase();
      case "contains":
        return text.toLowerCase().includes(needle.toLowerCase());
      case "gt":
        return typeof value === "number" && isNumeric && value > typed;
      case "gte":
        return typeof value === "number" && isNumeric && value >= typed;
      case "lt":
        return typeof value === "number" && isNumeric && value < typed;
      case "lte":
        return typeof value === "number" && isNumeric && value <= typed;
    }
  });
  return withRows(dataset, rows);
}

export function normalizeColumn(dataset: Dataset, column: string, method: NormalizeMethod): Dataset {
  const numbers = numericValues(dataset, column);
  if (numbers.length === 0) throw new Error("Cette colonne ne contient aucune valeur numérique.");
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
  const deviation = Math.sqrt(variance);
  const rows = dataset.rows.map((row) => {
    const value = row[column];
    if (typeof value !== "number" || !Number.isFinite(value)) return row;
    const next = method === "minmax" ? (max === min ? 0 : (value - min) / (max - min)) : deviation === 0 ? 0 : (value - mean) / deviation;
    return { ...row, [column]: Math.round(next * 1e6) / 1e6 };
  });
  return refreshTypes({ ...dataset, rows });
}

export function convertColumn(dataset: Dataset, column: string, target: ColumnType): Dataset {
  const rows = dataset.rows.map((row) => {
    const value = row[column];
    if (isMissing(value)) return row;
    let next: CellValue = value;
    if (target === "number") {
      const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      next = Number.isFinite(parsed) ? parsed : null;
    } else if (target === "boolean") {
      const text = String(value).toLowerCase();
      if (["true", "1", "oui", "yes"].includes(text)) next = true;
      else if (["false", "0", "non", "no"].includes(text)) next = false;
      else next = null;
    } else if (target === "string") {
      next = String(value);
    } else if (target === "date") {
      const date = new Date(String(value));
      next = Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    return { ...row, [column]: next };
  });
  return refreshTypes({ ...dataset, rows });
}

export function toCsv(dataset: Dataset): string {
  return Papa.unparse({
    fields: dataset.columns,
    data: dataset.rows.map((row) => dataset.columns.map((column) => row[column] ?? "")),
  });
}

export function toJson(dataset: Dataset): string {
  return JSON.stringify(
    dataset.rows.map((row) => Object.fromEntries(dataset.columns.map((column) => [column, row[column] ?? null]))),
    null,
    2,
  );
}

export function downloadDataset(dataset: Dataset, format: "csv" | "json"): void {
  const content = format === "csv" ? toCsv(dataset) : toJson(dataset);
  const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${dataset.name.replace(/\.[^.]+$/, "")}_propre.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
