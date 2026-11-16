import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { pluralForm } from "./plural";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function questionCount(count: number) {
  return `${count} ${pluralForm(count, ["odobreno pitanje", "odobrena pitanja", "odobrenih pitanja"])}`;
}
