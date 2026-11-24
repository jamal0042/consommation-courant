"use client";

import { useMemo, useRef, useState } from "react";
import {
  type ColumnType,
  type Dataset,
  type FillStrategy,
  type FilterOperator,
  type NormalizeMethod,
  computeStats,
  convertColumn,
  downloadDataset,
  dropColumns,
  dropDuplicates,
  dropMissingRows,
  fillMissing,
  filterRows,
  isSupportedFile,
  mergeDatasets,
  normalizeColumn,
  parseDatasetFile,
  renameColumn,
} from "@/lib/dataset";

type Tab = "apercu" | "stats" | "pretraitement";

const PAGE_SIZE = 10;

const TYPE_COLORS: Record<ColumnType, string> = {
  number: "bg-sky-100 text-sky-700",
  string: "bg-slate-100 text-slate-600",
  boolean: "bg-amber-100 text-amber-700",
  date: "bg-violet-100 text-violet-700",
  mixed: "bg-rose-100 text-rose-700",
};

const TYPE_LABELS: Record<ColumnType, string> = {
  number: "nombre",
  string: "texte",
  boolean: "booléen",
  date: "date",
  mixed: "mixte",
};

const FILTER_LABELS: Record<FilterOperator, string> = {
  equals: "égal à",
  notEquals: "différent de",
  contains: "contient",
  gt: "supérieur à",
  gte: "supérieur ou égal",
  lt: "inférieur à",
  lte: "inférieur ou égal",
  empty: "est vide",
  notEmpty: "n'est pas vide",
};

export default function DatasetStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Dataset | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [tab, setTab] = useState<Tab>("apercu");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [activeColumn, setActiveColumn] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [fillStrategy, setFillStrategy] = useState<FillStrategy>("mean");
  const [customValue, setCustomValue] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [filterOperator, setFilterOperator] = useState<FilterOperator>("contains");
  const [filterValue, setFilterValue] = useState("");
  const [normalizeMethod, setNormalizeMethod] = useState<NormalizeMethod>("minmax");
  const [targetType, setTargetType] = useState<ColumnType>("number");

  const stats = useMemo(() => (dataset ? computeStats(dataset) : []), [dataset]);

  const visibleRows = useMemo(() => {
    if (!dataset) return [];
    const needle = query.trim().toLowerCase();
    let rows = needle
      ? dataset.rows.filter((row) => dataset.columns.some((column) => String(row[column] ?? "").toLowerCase().includes(needle)))
      : dataset.rows;
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const left = a[sort.column];
        const right = b[sort.column];
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "fr");
        return sort.direction === "asc" ? result : -result;
      });
    }
    return rows;
  }, [dataset, query, sort]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function prepare(datasetToUse: Dataset) {
    setSource(datasetToUse);
    setDataset(datasetToUse);
    setHistory([]);
    setTab("apercu");
    setQuery("");
    setPage(0);
    setSort(null);
    setSelectedColumns([]);
    setActiveColumn(datasetToUse.columns[0] ?? "");
    setFilterColumn(datasetToUse.columns[0] ?? "");
    setRenameValue("");
  }

  async function loadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const invalid = list.filter((file) => !isSupportedFile(file));
      if (invalid.length > 0) throw new Error(`Format non pris en charge : ${invalid.map((file) => file.name).join(", ")}`);
      const datasets = await Promise.all(list.map(parseDatasetFile));
      prepare(mergeDatasets(datasets, list.length === 1 ? list[0].name : `${list.length} fichiers fusionnés`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de lire le fichier.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function applyChange(next: Dataset, label: string) {
    setDataset(next);
    setHistory((previous) => [...previous, label]);
    setPage(0);
    setError(null);
    const columns = next.columns;
    if (!columns.includes(activeColumn)) setActiveColumn(columns[0] ?? "");
    if (!columns.includes(filterColumn)) setFilterColumn(columns[0] ?? "");
    setSelectedColumns((previous) => previous.filter((column) => columns.includes(column)));
  }

  function run(label: string, action: (current: Dataset) => Dataset) {
    if (!dataset) return;
    try {
      applyChange(action(dataset), label);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opération impossible.");
    }
  }

  function resetDataset() {
    if (!source) return;
    setDataset(source);
    setHistory([]);
    setPage(0);
    setError(null);
    setSelectedColumns([]);
    setActiveColumn(source.columns[0] ?? "");
    setFilterColumn(source.columns[0] ?? "");
  }

  function toggleColumn(column: string) {
    setSelectedColumns((previous) => (previous.includes(column) ? previous.filter((item) => item !== column) : [...previous, column]));
  }

  function changeSort(column: string) {
    setSort((previous) => {
      if (previous?.column !== column) return { column, direction: "asc" };
      if (previous.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">DS</div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Atelier Dataset</h1>
              <p className="text-sm text-slate-500">Importez, explorez et préparez vos données</p>
            </div>
          </div>
          {dataset && (
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">{dataset.name}</span>
              <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">{dataset.rows.length} lignes</span>
              <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">{dataset.columns.length} colonnes</span>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">1. Importer le dataset</h2>
              <p className="mt-1 text-sm text-slate-500">Glissez vos fichiers ici ou sélectionnez-les. Plusieurs fichiers seront fusionnés.</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Lecture en cours…" : "Choisir des fichiers"}
            </button>
          </div>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void loadFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50 hover:border-indigo-400"}`}
          >
            <svg className="mb-3 size-9 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm font-medium">Déposez vos fichiers CSV, TSV, XLSX, JSON ou JSONL</p>
            <p className="mt-1 text-xs text-slate-400">La première ligne sert d&apos;en-tête pour les fichiers tabulaires</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xlsm"
            className="hidden"
            onChange={(event) => event.target.files && void loadFiles(event.target.files)}
          />
        </section>

        {error && (
          <div role="alert" className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="font-semibold">Fermer</button>
          </div>
        )}

        {dataset && (
          <>
            <nav className="flex flex-wrap gap-2 rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
              {([
                ["apercu", "Aperçu des données"],
                ["stats", "Statistiques"],
                ["pretraitement", "Prétraitement"],
              ] as [Tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {label}
                </button>
              ))}
            </nav>

            {tab === "apercu" && (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold">Aperçu</h2>
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(0);
                      }}
                      placeholder="Rechercher dans toutes les colonnes…"
                      className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => downloadDataset(dataset, "csv")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Exporter CSV</button>
                    <button type="button" onClick={() => downloadDataset(dataset, "json")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">Exporter JSON</button>
                  </div>
                </div>

                <div className="max-h-[540px] overflow-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100">
                      <tr>
                        <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-500">#</th>
                        {dataset.columns.map((column) => (
                          <th key={column} className="border-b border-slate-200 px-4 py-3">
                            <button type="button" onClick={() => changeSort(column)} className="flex items-center gap-2 font-semibold hover:text-indigo-600">
                              <span className="whitespace-nowrap">{column}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] ${TYPE_COLORS[dataset.types[column]]}`}>{TYPE_LABELS[dataset.types[column]]}</span>
                              <span className="text-indigo-500">{sort?.column === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, index) => (
                        <tr key={currentPage * PAGE_SIZE + index} className="odd:bg-white even:bg-slate-50/60">
                          <td className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-400">{currentPage * PAGE_SIZE + index + 1}</td>
                          {dataset.columns.map((column) => {
                            const value = row[column];
                            return (
                              <td key={column} className={`border-b border-slate-100 px-4 py-2.5 whitespace-nowrap ${value === null ? "text-slate-300" : typeof value === "number" ? "font-mono text-sky-700" : ""}`}>
                                {value === null ? "—" : typeof value === "boolean" ? (value ? "vrai" : "faux") : String(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {pageRows.length === 0 && (
                        <tr>
                          <td colSpan={dataset.columns.length + 1} className="px-4 py-12 text-center text-slate-500">Aucune ligne ne correspond à la recherche.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
                  <span>{visibleRows.length} ligne{visibleRows.length > 1 ? "s" : ""} affichée{visibleRows.length > 1 ? "s" : ""}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">Précédent</button>
                    <span className="px-2">Page {currentPage + 1} / {pageCount}</span>
                    <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">Suivant</button>
                  </div>
                </div>
              </section>
            )}

            {tab === "stats" && (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {stats.map((stat) => (
                  <article key={stat.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="truncate font-semibold" title={stat.name}>{stat.name}</h3>
                      <span className={`rounded px-2 py-0.5 text-xs ${TYPE_COLORS[stat.type]}`}>{TYPE_LABELS[stat.type]}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 py-2"><p className="text-lg font-bold">{stat.count}</p><p className="text-[11px] text-slate-500">valeurs</p></div>
                      <div className="rounded-lg bg-slate-50 py-2"><p className="text-lg font-bold">{stat.missing}</p><p className="text-[11px] text-slate-500">manquants</p></div>
                      <div className="rounded-lg bg-slate-50 py-2"><p className="text-lg font-bold">{stat.unique}</p><p className="text-[11px] text-slate-500">distincts</p></div>
                    </div>
                    <dl className="mt-4 space-y-1.5 text-sm">
                      <div className="flex justify-between"><dt className="text-slate-500">Minimum</dt><dd className="font-medium">{stat.min ?? "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Maximum</dt><dd className="font-medium">{stat.max ?? "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-slate-500">Moyenne</dt><dd className="font-medium">{stat.mean === null ? "—" : Number(stat.mean.toFixed(3))}</dd></div>
                    </dl>
                    {stat.top.length > 0 && (
                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Valeurs fréquentes</p>
                        <div className="space-y-1.5">
                          {stat.top.map((item) => (
                            <div key={item.value} className="flex items-center justify-between gap-2 text-xs">
                              <span className="max-w-[70%] truncate text-slate-600" title={item.value}>{item.value}</span>
                              <span className="font-semibold text-slate-500">{item.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}

            {tab === "pretraitement" && (
              <section className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="font-semibold">Supprimer des colonnes</h3>
                    <p className="mt-1 text-xs text-slate-500">Cochez les colonnes à retirer du dataset.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {dataset.columns.map((column) => (
                        <label key={column} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${selectedColumns.includes(column) ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 hover:bg-slate-50"}`}>
                          <input type="checkbox" checked={selectedColumns.includes(column)} onChange={() => toggleColumn(column)} className="mr-1.5 accent-rose-600" />
                          {column}
                        </label>
                      ))}
                    </div>
                    <button type="button" disabled={selectedColumns.length === 0} onClick={() => run(`Colonnes supprimées : ${selectedColumns.join(", ")}`, (current) => dropColumns(current, selectedColumns))} className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40">Supprimer la sélection</button>
                  </article>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="font-semibold">Renommer une colonne</h3>
                      <div className="mt-3 space-y-2">
                        <select value={activeColumn} onChange={(event) => { setActiveColumn(event.target.value); setRenameValue(""); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          {dataset.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                        </select>
                        <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder="Nouveau nom" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        <button type="button" disabled={!renameValue.trim()} onClick={() => run(`Colonne « ${activeColumn} » renommée`, (current) => renameColumn(current, activeColumn, renameValue))} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">Renommer</button>
                      </div>
                    </article>

                    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="font-semibold">Valeurs manquantes</h3>
                      <div className="mt-3 space-y-2">
                        <select value={fillStrategy} onChange={(event) => setFillStrategy(event.target.value as FillStrategy)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          <option value="mean">Remplacer par la moyenne</option>
                          <option value="median">Remplacer par la médiane</option>
                          <option value="mode">Remplacer par le mode</option>
                          <option value="custom">Valeur personnalisée</option>
                        </select>
                        {fillStrategy === "custom" && <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="Valeur" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />}
                        <button type="button" onClick={() => run(`Manquants comblés dans « ${activeColumn} »`, (current) => fillMissing(current, activeColumn, fillStrategy, customValue))} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Combler « {activeColumn} »</button>
                        <button type="button" onClick={() => run("Lignes avec valeurs manquantes supprimées", (current) => dropMissingRows(current, selectedColumns))} className="block rounded-lg border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50">Supprimer les lignes incomplètes</button>
                      </div>
                    </article>

                    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="font-semibold">Filtrer les lignes</h3>
                      <div className="mt-3 space-y-2">
                        <select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                          {dataset.columns.map((column) => <option key={column} value={column}>{column}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as FilterOperator)} className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                            {Object.entries(FILTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="Valeur" disabled={filterOperator === "empty" || filterOperator === "notEmpty"} className="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100" />
                        </div>
                        <button type="button" onClick={() => run(`Filtre appliqué sur « ${filterColumn} »`, (current) => filterRows(current, filterColumn, filterOperator, filterValue))} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Appliquer le filtre</button>
                      </div>
                    </article>

                    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="font-semibold">Transformer une colonne</h3>
                      <div className="mt-3 space-y-2">
                        <div className="flex gap-2">
                          <select value={normalizeMethod} onChange={(event) => setNormalizeMethod(event.target.value as NormalizeMethod)} className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                            <option value="minmax">Min-max (0–1)</option>
                            <option value="zscore">Z-score</option>
                          </select>
                          <button type="button" onClick={() => run(`« ${activeColumn} » normalisée`, (current) => normalizeColumn(current, activeColumn, normalizeMethod))} className="w-1/2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500">Normaliser</button>
                        </div>
                        <div className="flex gap-2">
                          <select value={targetType} onChange={(event) => setTargetType(event.target.value as ColumnType)} className="w-1/2 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                            <option value="number">Nombre</option>
                            <option value="string">Texte</option>
                            <option value="boolean">Booléen</option>
                            <option value="date">Date</option>
                          </select>
                          <button type="button" onClick={() => run(`« ${activeColumn} » convertie en ${TYPE_LABELS[targetType]}`, (current) => convertColumn(current, activeColumn, targetType))} className="w-1/2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Convertir</button>
                        </div>
                        <button type="button" onClick={() => run("Doublons supprimés", dropDuplicates)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Supprimer les lignes en double</button>
                      </div>
                    </article>
                  </div>
                </div>

                <aside className="space-y-4">
                  <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="font-semibold">Historique des transformations</h3>
                    {history.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">Aucune transformation appliquée.</p>
                    ) : (
                      <ol className="mt-3 space-y-2 text-sm">
                        {history.map((entry, index) => (
                          <li key={`${entry}-${index}`} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2">
                            <span className="font-semibold text-indigo-600">{index + 1}.</span>
                            <span>{entry}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <button type="button" onClick={resetDataset} disabled={history.length === 0} className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40">Réinitialiser le dataset</button>
                  </article>
                  <article className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
                    <h3 className="font-semibold text-indigo-900">Dataset actuel</h3>
                    <p className="mt-2 text-sm text-indigo-800">{dataset.rows.length} lignes · {dataset.columns.length} colonnes</p>
                    <p className="mt-1 break-all text-xs text-indigo-700">{dataset.name}</p>
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => downloadDataset(dataset, "csv")} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500">CSV</button>
                      <button type="button" onClick={() => downloadDataset(dataset, "json")} className="flex-1 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">JSON</button>
                    </div>
                  </article>
                </aside>
              </section>
            )}
          </>
        )}

        {!dataset && (
          <section className="grid gap-4 sm:grid-cols-3">
            {[
              ["Importer", "CSV, Excel, JSON et JSONL, y compris plusieurs fichiers à la fois."],
              ["Explorer", "Aperçu paginé, recherche, tri par colonne et statistiques détaillées."],
              ["Prétraiter", "Nettoyage, filtres, normalisation et export du dataset prêt à l'emploi."],
            ].map(([title, description], index) => (
              <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="text-xs font-bold text-indigo-600">0{index + 1}</span>
                <h3 className="mt-2 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-500">{description}</p>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
