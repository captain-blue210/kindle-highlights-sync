import { Document, isMap, parseDocument } from "yaml";

export const PROPERTY_FIELDS = ["bookId", "title", "author", "highlightsCount", "asin", "lastAnnotatedDate", "bookImageUrl"] as const;
export type PropertyField = typeof PROPERTY_FIELDS[number];
export type PropertyNames = Record<PropertyField, string>;
export const DEFAULT_PROPERTY_NAMES: PropertyNames = {
 bookId: "bookId", title: "title", author: "author", highlightsCount: "highlights",
 asin: "ASIN", lastAnnotatedDate: "lastAnnotated", bookImageUrl: "image",
};
export interface BookProperties {
 bookId: string; title: string; author?: string; highlightsCount?: number;
 asin?: string; lastAnnotatedDate?: string; bookImageUrl?: string;
}
export interface PropertyConflict { field: PropertyField; kept: unknown; source: unknown; }
export interface PropertyMigration { content: string; changed: boolean; recognized: boolean; conflicts: PropertyConflict[]; changes: string[]; }
const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function validatePropertyNames(names: PropertyNames): void {
 const used = new Set<string>();
 for (const field of PROPERTY_FIELDS) {
  const name = names[field];
  if (typeof name !== "string" || !name.trim() || name !== name.trim() || /[\r\n\0]/.test(name) ||
   ["__proto__", "prototype", "constructor", "tags", "aliases", "created", "updated", "kindle-sync"].includes(name) || used.has(name)) {
   throw new Error(`Invalid or duplicate property name: ${field}`);
  }
  // Legacy keys remain readable; using a different field's key would make conversion ambiguous.
  if (PROPERTY_FIELDS.some(other => other !== field && (name === `kindle-${other}` || name === DEFAULT_PROPERTY_NAMES[other]))) {
   throw new Error(`Property name belongs to another Kindle field: ${name}`);
  }
  used.add(name);
 }
}

export function splitNote(content: string): {frontmatter: string; body: string; prefix: string; newline: string; hasFrontmatter: boolean} {
 const match = /^(\uFEFF?)---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(content);
 if (match && match.index === 0) return {frontmatter: match[2], body: content.slice(match[0].length), prefix: match[1], newline: match[0].includes("\r\n") ? "\r\n" : "\n", hasFrontmatter: true};
 if (/^\uFEFF?---(?:\r?\n|$)/.test(content)) throw new Error("Unclosed YAML frontmatter");
 return {frontmatter:"",body:content,prefix:"",newline:"\n",hasFrontmatter:false};
}
function parseNote(content: string) {
 const parts = splitNote(content);
 const doc = parseDocument(parts.frontmatter, {stringKeys: true, uniqueKeys: true});
 if (doc.errors.length || doc.warnings.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error("Invalid YAML frontmatter");
 const record: Record<string, unknown> = doc.toJS({maxAliasCount: 50}) ?? {};
 return {parts, doc, record};
}
function sourceKeys(field: PropertyField, names: PropertyNames, history: PropertyNames[]) {
 return Array.from(new Set([names[field], ...history.map(n => n[field]), DEFAULT_PROPERTY_NAMES[field], `kindle-${field}`]));
}
function valuesFor(record: Record<string, unknown>, field: PropertyField, names: PropertyNames, history: PropertyNames[]) {
 const nested = record["kindle-sync"];
 const values = sourceKeys(field,names,history).map(key=>({key,value:record[key]}));
 if (nested && typeof nested === "object" && !Array.isArray(nested)) values.push({key:`kindle-sync.${field}`,value:(nested as Record<string,unknown>)[field]});
 return values.filter(v=>!empty(v.value));
}
function readRecord(record: Record<string, unknown>, names: PropertyNames, history: PropertyNames[]): BookProperties | null {
 const out: Record<string,unknown> = {};
 for (const f of PROPERTY_FIELDS) out[f] = valuesFor(record,f,names,history)[0]?.value;
 if (empty(out.bookId) || typeof out.title !== "string" || !out.title.trim()) return null;
 if (!["string","number"].includes(typeof out.bookId)) throw new Error("Invalid Kindle book ID");
 const stringValue = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v) : undefined;
 const count = Number(out.highlightsCount);
 return {bookId:String(out.bookId),title:out.title,author:stringValue(out.author),asin:stringValue(out.asin),lastAnnotatedDate:stringValue(out.lastAnnotatedDate),bookImageUrl:stringValue(out.bookImageUrl),highlightsCount: !empty(out.highlightsCount) && Number.isFinite(count) && count >= 0 ? count : undefined};
}
export function readBookProperties(content: string, names: PropertyNames = DEFAULT_PROPERTY_NAMES, history: PropertyNames[] = []): BookProperties | null {
 validatePropertyNames(names);
 return readRecord(parseNote(content).record,names,history);
}
function serialize(doc: Document, parts: ReturnType<typeof splitNote>): string {
 const yaml = doc.toString({lineWidth:0}).replace(/\n/g,parts.newline);
 const result = `${parts.prefix}---${parts.newline}${yaml}---${parts.newline}${parts.hasFrontmatter ? "" : parts.newline}${parts.body}`;
 // Deleting a legacy anchor must never produce an unresolved alias in another property.
 parseNote(result);
 return result;
}
export function migrateProperties(content: string, names: PropertyNames = DEFAULT_PROPERTY_NAMES, history: PropertyNames[] = []): PropertyMigration {
 validatePropertyNames(names);
 const {parts,doc,record} = parseNote(content);
 if (!readRecord(record,names,history)) return {content,changed:false,recognized:false,conflicts:[],changes:[]};
 const conflicts: PropertyConflict[] = [], changes: string[] = [];
 const chosen: Partial<Record<PropertyField,unknown>> = {};
 for (const field of PROPERTY_FIELDS) {
  const values=valuesFor(record,field,names,history);
  if (values.length) {
   chosen[field]=values[0].value;
   for (const other of values.slice(1)) if (JSON.stringify(other.value)!==JSON.stringify(values[0].value)) conflicts.push({field,kept:values[0].value,source:other.value});
  }
 }
 for (const field of PROPERTY_FIELDS) {
  for (const key of sourceKeys(field,names,history)) if (key!==names[field] && doc.has(key)) {
   const pair=isMap(doc.contents)?doc.contents.items.find(p=>String(p.key)===key):undefined;
   const comments=[pair?.key,pair?.value].flatMap(node=>node && typeof node==='object' ? [(node as {commentBefore?:string}).commentBefore,(node as {comment?:string}).comment].filter(Boolean) : []);
   if(comments.length)doc.commentBefore=[doc.commentBefore,...comments].filter(Boolean).join('\n');
   doc.delete(key);changes.push(`- ${key}`);
  }
  if (doc.hasIn(["kindle-sync",field])) {doc.deleteIn(["kindle-sync",field]);changes.push(`- kindle-sync.${field}`);}
 }
 if (doc.has("kindle-sync") && isMap(doc.get("kindle-sync",true)) && (doc.get("kindle-sync",true) as {items:unknown[]}).items.length===0) doc.delete("kindle-sync");
 for (const field of PROPERTY_FIELDS) {
  if (chosen[field]!==undefined && JSON.stringify(record[names[field]])!==JSON.stringify(chosen[field])) {doc.set(names[field],chosen[field]);changes.push(`+ ${names[field]}`);}
 }
 return {content:changes.length?serialize(doc,parts):content,changed:changes.length>0,recognized:true,conflicts,changes};
}

export function updateBookProperties(content: string, book: BookProperties, names: PropertyNames = DEFAULT_PROPERTY_NAMES, history: PropertyNames[] = []): string {
 validatePropertyNames(names);
 const {doc,parts,record}=parseNote(content);
 const existing=readRecord(record,names,history);
 const values: Partial<Record<PropertyField,unknown>> = {...book, bookId:existing?.bookId ?? book.bookId};
 for (const field of PROPERTY_FIELDS) {
  const value=values[field];
  if (empty(value)) continue;
  // IDs and descriptive properties may have been curated by the user.
  if (["bookId","title","author","asin","bookImageUrl"].includes(field) && !empty(record[names[field]])) continue;
  if (field === "lastAnnotatedDate" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) continue;
  doc.set(names[field],value);
 }
 return serialize(doc,parts);
}
