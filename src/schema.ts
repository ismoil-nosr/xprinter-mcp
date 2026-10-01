// SPDX-License-Identifier: MIT
import { z } from 'zod';

export const profileSchema = z.object({
    widthMm: z.number().min(20).max(76).default(58),
    heightMm: z.number().min(10).max(200).default(40),
    stock: z.enum(['gap', 'black-mark', 'continuous']).default('gap'),
    gapMm: z.number().int().min(0).max(10).default(2),
    darkness: z.number().int().min(0).max(15).default(7),
}).strict().refine(p => p.stock !== 'gap' || p.gapMm > 0, 'Gap stock requires a gap greater than zero.');
export type Profile = z.infer<typeof profileSchema>;
export const labelSchema = z.object({
    kind: z.enum(['code128', 'qr', 'text']),
    title: z.string().max(120).default(''),
    code: z.string().min(1).max(800),
    footer: z.string().max(160).default(''),
    quantity: z.number().int().min(1).max(100).default(1),
}).strict().superRefine((v, ctx) => {
    if (v.kind === 'code128' && (!/^[\x20-\x7e]{1,80}$/.test(v.code))) {
        ctx.addIssue({ code: 'custom', message: 'Code 128 needs 1–80 printable ASCII characters. Use QR for Unicode.' });
    }
    if (v.kind === 'qr' && Buffer.byteLength(v.code) > 800) {
        ctx.addIssue({ code: 'custom', message: 'QR content exceeds 800 UTF-8 bytes.' });
    }
});
export const prepareLabelsSchema = z.object({
    profile: profileSchema.default({ widthMm: 58, heightMm: 40, stock: 'gap', gapMm: 2, darkness: 7 }),
    labels: z.array(labelSchema).min(1).max(50),
}).strict().refine(v => v.labels.reduce((n, l) => n + l.quantity, 0) <= 100, 'At most 100 labels per batch.');
export type PrepareLabels = z.infer<typeof prepareLabelsSchema>;
export const preparePdfSchema = z.object({
    profile: profileSchema.default({ widthMm: 58, heightMm: 40, stock: 'gap', gapMm: 2, darkness: 7 }),
    pdfBase64: z.string().min(8).max(2_796_204).refine(v => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && v.length % 4 === 0, 'Use canonical base64.'),
    rotate: z.boolean().default(false),
}).strict();
export type PreparePdf = z.infer<typeof preparePdfSchema>;
const uuid = z.uuid().transform(value => value.toLowerCase());
export const artifactSchema = z.object({ artifactId: uuid }).strict();
export const printSchema = artifactSchema.extend({
    copies: z.number().int().min(1).max(100).default(1),
    idempotencyKey: uuid.describe('Generate once per intended print; reuse exactly this key on network retries.'),
    confirmed: z.literal(true).describe('The user explicitly requested this physical print and reviewed the preview, dimensions and quantity.'),
}).strict();
export const jobSchema = z.object({ jobId: uuid }).strict();
export const renderResponseSchema = z.object({
    pdfBase64: z.string().max(8_388_608), previewBase64: z.string().max(4_194_304),
    pages: z.number().int().min(1).max(100), widthMm: z.number(), heightMm: z.number(),
});
export interface Rendered { pdf: Buffer; preview: Buffer; pages: number }
export interface ArtifactSummary { artifactId: string; pages: number; profile: Profile; expiresAt: string; previewPage: number }
export interface Artifact extends ArtifactSummary { pdf: Buffer; preview: Buffer }
export interface Job {
    jobId: string; artifactId: string; copies: number; labels: number;
    state: 'uncertain' | 'submitted' | 'cancelled'; cupsJobId: number | null; createdAt: string;
}
