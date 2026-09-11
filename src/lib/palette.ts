/**
 * 複数バリアントを見分けるための色。
 * 表・全体像マップ・配列ビュー・PNG 出力で同じ色を使うため、ここに一元化する。
 */

/** 明暗どちらの配色でも読める彩度と明度に揃えてある */
export const VARIANT_COLORS = [
  '#2563eb', // 青
  '#d0342c', // 赤
  '#7c3aed', // 紫
  '#0f766e', // 緑
  '#c2760a', // 橙
  '#be185d', // 桃
] as const;

export function variantColor(index: number): string {
  return VARIANT_COLORS[index % VARIANT_COLORS.length];
}

/** 表や凡例で使う連番ラベル（V1, V2, …） */
export function variantTag(index: number): string {
  return `V${index + 1}`;
}
