"use client";
import { template } from "lodash";
import Link from "next/link";

export default function Cart() {
  const render = template("<b><%= total %></b>");
  return <Link href="/">{render({ total: 1 })}</Link>;
}
