export declare function ApiOperationWithDocs(
  summary: string,
  description?: string,
): <TFunction extends Function, Y>(
  target: TFunction | object,
  propertyKey?: string | symbol,
  descriptor?: TypedPropertyDescriptor<Y>,
) => void;
export declare function ApiGetOperationWithDocs(
  summary: string,
): <TFunction extends Function, Y>(
  target: TFunction | object,
  propertyKey?: string | symbol,
  descriptor?: TypedPropertyDescriptor<Y>,
) => void;
export declare function ApiCreateOperationWithDocs(
  summary: string,
): <TFunction extends Function, Y>(
  target: TFunction | object,
  propertyKey?: string | symbol,
  descriptor?: TypedPropertyDescriptor<Y>,
) => void;
