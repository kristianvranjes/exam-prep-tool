import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export function questionCount(count: number) {
  return `${count} approved ${count === 1 ? "question" : "questions"}`;
}
