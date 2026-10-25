export type PropertyKind =
  | 'text'
  | 'number'
  | 'date'
  | 'tags'
  | 'select'
  | 'multiSelect'
  | 'checkbox'
  | 'url'
  | 'phone'
  | 'email';

export interface PropertyDefinition {
  name: string;
  kind: PropertyKind;
  options: string[];
  required: boolean;
  default?: unknown;
  format?: string;
}

export interface ObjectType {
  name: string;
  icon?: string;
  color?: string;
  extends?: string;
  properties: PropertyDefinition[];
}

export interface ObjectSchema {
  version: number;
  types: ObjectType[];
}

export interface Violation {
  property: string;
  reason: string;
}

export const NOTE_TYPE = 'Note';
