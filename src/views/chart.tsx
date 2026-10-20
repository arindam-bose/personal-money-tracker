// A thin Preact wrapper around ECharts. Only the chart types we use are bundled.
// Colours come from the CSS tokens in style.css, so charts follow light/dark mode.

import { signal } from "@preact/signals";
import { BarChart, LineChart, SankeyChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "preact/hooks";

echarts.use([BarChart, LineChart, SankeyChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

/** Changes when the system switches between light and dark, so charts re-read their colours. */
export const colorScheme = signal(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  colorScheme.value = e.matches ? "dark" : "light";
});

/** The current value of a CSS colour token, e.g. token("--series-1"). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Series colours in their fixed order. Reading colorScheme makes callers re-render on a theme switch. */
export function seriesColors(): string[] {
  void colorScheme.value;
  return [1, 2, 3, 4, 5, 6].map((i) => token(`--series-${i}`));
}

/** Shared look: system font, muted axes, hairline grid, tooltip in the page colours. */
export function baseOption(): ChartOption {
  void colorScheme.value;
  const text = token("--text");
  const muted = token("--muted");
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: text },
    // Brief, and off entirely for people who ask their system for less motion.
    animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationDuration: 300,
    tooltip: {
      backgroundColor: token("--surface"),
      borderColor: token("--border"),
      textStyle: { color: text, fontSize: 13 },
      confine: true,
    },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: muted } },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
  };
}

/** Axis styling: no tick marks, hairline baseline, solid hairline gridlines. */
export function axisStyle() {
  return {
    axisLine: { lineStyle: { color: token("--chart-axis") } },
    axisTick: { show: false },
    axisLabel: { color: token("--muted") },
    splitLine: { lineStyle: { color: token("--chart-grid"), type: "solid" as const } },
  };
}

interface Props {
  option: ChartOption;
  height: number;
  /** What the chart shows, for screen readers. The table view below each chart has the numbers. */
  label: string;
}

export function Chart({ option, height, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const c = echarts.init(el.current!, null, { renderer: "svg" });
    chart.current = c;
    const resize = new ResizeObserver(() => c.resize());
    resize.observe(el.current!);
    return () => {
      resize.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} class="chart" style={{ height }} role="img" aria-label={label} />;
}
