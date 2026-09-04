import dayjs from "dayjs";

export const hasValue = (value: unknown) => value !== undefined && value !== null && value !== "";

export type DisplayValue<T extends string | number = string | number> = T | null | undefined;
export type EmptyFallback<T extends string | number = string | number> =
  | string
  | ((value: DisplayValue<T>) => string);

const resolveEmptyFallback = <T extends string | number>(
  value: DisplayValue<T>,
  emptyFallback: EmptyFallback<T>,
) => (typeof emptyFallback === "function" ? emptyFallback(value) : emptyFallback);

export const displayValue = <T extends string | number>(
  value: DisplayValue<T>,
  emptyFallback: EmptyFallback<T> = "-",
) => (hasValue(value) ? String(value) : resolveEmptyFallback(value, emptyFallback));

const formatDateValue = (value: DisplayValue<string>, template: string) => {
  if (!value) {
    return displayValue(value);
  }

  const date = dayjs(value);
  return date.isValid() ? date.format(template) : displayValue(value);
};

export const formatDate = (value: DisplayValue<string>, template = "YYYY-MM-DD") =>
  formatDateValue(value, template);

export const formatDateTime = (value: DisplayValue<string>, template = "YYYY-MM-DD HH:mm") =>
  formatDateValue(value, template);
