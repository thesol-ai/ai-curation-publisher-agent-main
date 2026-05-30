export type SettingValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export type Setting = {
  key: string;
  value: SettingValue;
  description?: string;
  isSecret: boolean;
  createdAt: string;
  updatedAt: string;
};
