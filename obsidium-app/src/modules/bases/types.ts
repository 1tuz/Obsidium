export type BaseScalar = string | number | boolean | null;
export type BaseYamlValue = BaseScalar | BaseYamlValue[] | { [key: string]: BaseYamlValue };
export type BaseFilter = string | {
  unsupported?: true;
  and?: BaseFilter[];
  or?: BaseFilter[];
  not?: BaseFilter | BaseFilter[];
  raw?: BaseYamlValue;
};

export interface BaseGroupBy {
  property: string;
  direction?: 'ASC' | 'DESC';
}

export interface BaseSort {
  property: string;
  direction?: 'ASC' | 'DESC';
}

export interface BaseViewDefinition {
  type: string;
  name: string;
  limit?: number;
  dateField?: string;
  order: string[];
  filters?: BaseFilter;
  groupBy?: BaseGroupBy;
  groupOrder?: BaseScalar[];
  sort?: BaseSort[];
  extra?: Record<string, BaseYamlValue>;
}

export interface BaseSummary {
  name: string;
  source: string;
  property: string;
  formula: string;
  filter?: BaseFilter;
}

export interface BaseDefinition {
  raw: string;
  filters?: BaseFilter;
  views: BaseViewDefinition[];
  summaries: BaseSummary[];
  propertyLabels: Record<string, string>;
  formulas: Record<string, string>;
  unsupportedKeys: string[];
  extra: Record<string, BaseYamlValue>;
}

export type BaseFieldValue = string | string[] | number | boolean | null;

export interface BaseRow {
  path: string;
  fields: Record<string, BaseFieldValue>;
}

export interface BaseQuery {
  definition: BaseDefinition;
  viewIndex: number;
  sort?: BaseSort[];
}

export interface BaseGroup {
  label: string | null;
  start: number;
  end: number;
}

export interface BaseFormulaError {
  formula: string;
  path: string;
  message: string;
}

export interface BaseEvaluation {
  rows: BaseRow[];
  groups: BaseGroup[];
  columns: string[];
  unsupported: boolean;
  errors: BaseFormulaError[];
}
