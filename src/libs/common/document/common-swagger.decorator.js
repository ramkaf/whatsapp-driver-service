import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
export function ApiOperationWithDocs(summary, description) {
    return applyDecorators(ApiOperation({ summary, description }), ApiResponse({ status: 200, description: 'Success' }), ApiResponse({ status: 400, description: 'Bad Request' }), ApiResponse({ status: 403, description: 'Forbidden' }));
}
export function ApiGetOperationWithDocs(summary) {
    return applyDecorators(ApiOperationWithDocs(summary), ApiResponse({ status: 404, description: 'Not Found' }));
}
export function ApiCreateOperationWithDocs(summary) {
    return applyDecorators(ApiOperationWithDocs(summary), ApiResponse({ status: 201, description: 'Created' }));
}
//# sourceMappingURL=common-swagger.decorator.js.map