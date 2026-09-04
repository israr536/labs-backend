export type MasterParameter = {
  name: string;
  inputType: 'NUMBER' | 'TEXT' | 'SELECT';
  unit?: string;
  normalMin?: number;
  normalMax?: number;
  referenceRange?: Record<string, string>;
  options?: string[];
  remarks?: string;
};

export const MASTER_PARAMETERS = [];