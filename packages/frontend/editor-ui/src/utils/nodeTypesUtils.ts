import type { AppliedThemeOption, INodeUi, NodeAuthenticationOption } from '@/Interface';
import type { ITemplatesNode } from '@n8n/rest-api-client/api/templates';
import {
	CORE_NODES_CATEGORY,
	MAIN_AUTH_FIELD_NAME,
	MAPPING_PARAMS,
	NON_ACTIVATABLE_TRIGGER_NODE_TYPES,
	TEMPLATES_NODES_FILTER,
} from '@/constants';
import { i18n as locale } from '@n8n/i18n';
import { useCredentialsStore } from '@/stores/credentials.store';
import { useNodeTypesStore } from '@/stores/nodeTypes.store';
import { useWorkflowsStore } from '@/stores/workflows.store';
import { isJsonKeyObject } from '@/utils/typesUtils';
import {
	isResourceLocatorValue,
	type IDataObject,
	type INodeCredentialDescription,
	type INodeExecutionData,
	type INodeProperties,
	type INodeTypeDescription,
	type NodeParameterValueType,
	type ResourceMapperField,
	type Themed,
} from 'n8n-workflow';

/*
	Constants and utility functions mainly used to get information about
	or manipulate node types and nodes.
*/

const CRED_KEYWORDS_TO_FILTER = ['API', 'OAuth1', 'OAuth2'];
const NODE_KEYWORDS_TO_FILTER = ['Trigger'];
const COMMUNITY_PACKAGE_NAME_REGEX = /^(?!@n8n\/)(@\w+\/)?n8n-nodes-(?!base\b)\b\w+/g;
const RESOURCE_MAPPER_FIELD_NAME_REGEX = /value\[\"(.+)\"\]/;

export function getAppNameFromCredType(name: string) {
	return name
		.split(' ')
		.filter((word) => !CRED_KEYWORDS_TO_FILTER.includes(word))
		.join(' ');
}

export function getAppNameFromNodeName(name: string) {
	return name
		.split(' ')
		.filter((word) => !NODE_KEYWORDS_TO_FILTER.includes(word))
		.join(' ');
}

export function getTriggerNodeServiceName(nodeType: INodeTypeDescription): string {
	return nodeType.displayName.replace(/ trigger/i, '');
}

export function getActivatableTriggerNodes(nodes: INodeUi[]) {
	return nodes.filter(
		(node: INodeUi) => !node.disabled && !NON_ACTIVATABLE_TRIGGER_NODE_TYPES.includes(node.type),
	);
}

export function filterTemplateNodes(nodes: ITemplatesNode[]) {
	const notCoreNodes = nodes.filter((node: ITemplatesNode) => {
		return !(node.categories || []).some((category) => category.name === CORE_NODES_CATEGORY);
	});

	const results = notCoreNodes.length > 0 ? notCoreNodes : nodes;
	return results.filter((elem) => !TEMPLATES_NODES_FILTER.includes(elem.name));
}

export function isCommunityPackageName(packageName: string): boolean {
	COMMUNITY_PACKAGE_NAME_REGEX.lastIndex = 0;
	// Community packages names start with <@username/>n8n-nodes- not followed by word 'base'
	const nameMatch = COMMUNITY_PACKAGE_NAME_REGEX.exec(packageName);

	return !!nameMatch;
}

export function hasExpressionMapping(value: unknown) {
	return typeof value === 'string' && !!MAPPING_PARAMS.find((param) => value.includes(param));
}

export function isValueExpression(
	parameter: INodeProperties,
	paramValue: NodeParameterValueType,
): boolean {
	if (parameter.noDataExpression === true) {
		return false;
	}
	if (typeof paramValue === 'string' && paramValue.charAt(0) === '=') {
		return true;
	}
	if (
		isResourceLocatorValue(paramValue) &&
		paramValue.value &&
		paramValue.value.toString().charAt(0) === '='
	) {
		return true;
	}
	return false;
}

export const executionDataToJson = (inputData: INodeExecutionData[]): IDataObject[] =>
	inputData.reduce<IDataObject[]>(
		(acc, item) => (isJsonKeyObject(item) ? acc.concat(item.json) : acc),
		[],
	);

export const hasOnlyListMode = (parameter: INodeProperties): boolean => {
	return (
		parameter.modes !== undefined &&
		parameter.modes.length === 1 &&
		parameter.modes[0].name === 'list'
	);
};

/**
 * A credential type is considered required if it has no dependencies
 * or if it's only dependency is the main authentication fields
 */
export const isRequiredCredential = (
	nodeType: INodeTypeDescription | null,
	credential: INodeCredentialDescription,
): boolean => {
	if (!credential.displayOptions?.show) {
		return true;
	}

	const mainAuthField = getMainAuthField(nodeType);
	if (mainAuthField) {
		return mainAuthField.name in credential.displayOptions.show;
	}

	return false;
};

/**
 * Find the main authentication field for the node type.
 * It's the field that node's required credential depend on
 */
export const getMainAuthField = (nodeType: INodeTypeDescription | null): INodeProperties | null => {
	if (!nodeType) {
		return null;
	}

	const credentialDependencies = getNodeAuthFields(nodeType);
	const authenticationField =
		credentialDependencies.find(
			(prop) =>
				prop.name === MAIN_AUTH_FIELD_NAME &&
				!prop.options?.find((option) => 'value' in option && option.value === 'none'),
		) ?? null;

	// If there is a field name `authentication`, use it
	// Otherwise, try to find alternative main auth field
	const mainAuthFiled =
		authenticationField ?? findAlternativeAuthField(nodeType, credentialDependencies);
	// Main authentication field has to be required
	const isFieldRequired = mainAuthFiled ? isNodeParameterRequired(nodeType, mainAuthFiled) : false;
	return mainAuthFiled && isFieldRequired ? mainAuthFiled : null;
};

/**
 * A field is considered main auth filed if:
 * 1. It is a credential dependency
 * 2. If all of it's possible values are used in credential's display options
 */
const findAlternativeAuthField = (
	nodeType: INodeTypeDescription,
	fields: INodeProperties[],
): INodeProperties | null => {
	const dependentAuthFieldValues: { [fieldName: string]: string[] } = {};
	nodeType.credentials?.forEach((cred) => {
		if (cred.displayOptions?.show) {
			for (const fieldName in cred.displayOptions.show) {
				dependentAuthFieldValues[fieldName] = (dependentAuthFieldValues[fieldName] || []).concat(
					(cred.displayOptions.show[fieldName] ?? []).map((val) => (val ? val.toString() : '')),
				);
			}
		}
	});
	const alternativeAuthField = fields.find((field) => {
		let required = true;
		field.options?.forEach((option) => {
			if (
				'value' in option &&
				typeof option.value === 'string' &&
				!dependentAuthFieldValues[field.name].includes(option.value)
			) {
				required = false;
			}
		});
		return required;
	});
	return alternativeAuthField || null;
};

/**
 * Gets all authentication types that a given node type supports
 */
export const getNodeAuthOptions = (
	nodeType: INodeTypeDescription | null,
	nodeVersion?: number,
): NodeAuthenticationOption[] => {
	if (!nodeType) {
		return [];
	}
	const recommendedSuffix = locale.baseText(
		'credentialEdit.credentialConfig.recommendedAuthTypeSuffix',
	);
	let options: NodeAuthenticationOption[] = [];
	const authProp = getMainAuthField(nodeType);
	// Some nodes have multiple auth fields with same name but different display options so need
	// take them all into account
	const authProps = getNodeAuthFields(nodeType, nodeVersion).filter(
		(prop) => prop.name === authProp?.name,
	);

	authProps.forEach((field) => {
		if (field.options) {
			options = options.concat(
				field.options.map((option) => {
					const optionValue = 'value' in option ? `${option.value}` : '';

					// Check if credential type associated with this auth option has overwritten properties
					let hasOverrides = false;
					const cred = getNodeCredentialForSelectedAuthType(nodeType, optionValue);
					if (cred) {
						hasOverrides =
							useCredentialsStore().getCredentialTypeByName(cred.name)?.__overwrittenProperties !==
							undefined;
					}

					return {
						name:
							// Add recommended suffix if credentials have overrides and option is not already recommended
							hasOverrides && !option.name.endsWith(recommendedSuffix)
								? `${option.name} ${recommendedSuffix}`
								: option.name,
						value: optionValue,
						// Also add in the display options so we can hide/show the option if necessary
						displayOptions: field.displayOptions,
					};
				}) || [],
			);
		}
	});
	// sort so recommended options are first
	options.forEach((item, i) => {
		if (item.name.includes(recommendedSuffix)) {
			options.splice(i, 1);
			options.unshift(item);
		}
	});
	return options;
};

export const getAllNodeCredentialForAuthType = (
	nodeType: INodeTypeDescription | null,
	authType: string,
): INodeCredentialDescription[] => {
	if (nodeType) {
		return (
			nodeType.credentials?.filter(
				(cred) => cred.displayOptions?.show && authType in (cred.displayOptions.show || {}),
			) ?? []
		);
	}

	return [];
};

export const getNodeCredentialForSelectedAuthType = (
	nodeType: INodeTypeDescription,
	authType: string,
): INodeCredentialDescription | null => {
	const authField = getMainAuthField(nodeType);
	const authFieldName = authField ? authField.name : '';
	return (
		nodeType.credentials?.find((cred) =>
			cred.displayOptions?.show?.[authFieldName]?.includes(authType),
		) || null
	);
};

export const getAuthTypeForNodeCredential = (
	nodeType: INodeTypeDescription | null | undefined,
	credentialType: INodeCredentialDescription | null | undefined,
): NodeAuthenticationOption | null => {
	if (nodeType && credentialType) {
		const authField = getMainAuthField(nodeType);
		const authFieldName = authField ? authField.name : '';
		const nodeAuthOptions = getNodeAuthOptions(nodeType);
		return (
			nodeAuthOptions.find((option) =>
				credentialType.displayOptions?.show?.[authFieldName]?.includes(option.value),
			) || null
		);
	}
	return null;
};

export const isAuthRelatedParameter = (
	authFields: INodeProperties[],
	parameter: INodeProperties,
): boolean => {
	let isRelated = false;
	authFields.forEach((prop) => {
		if (prop.displayOptions?.show && parameter.name in prop.displayOptions.show) {
			isRelated = true;
			return;
		}
	});
	return isRelated;
};

/**
 * Get all node type properties needed for determining whether to show authentication fields
 */
export const getNodeAuthFields = (
	nodeType: INodeTypeDescription | null,
	nodeVersion?: number,
): INodeProperties[] => {
	const authFields: INodeProperties[] = [];
	if (nodeType?.credentials && nodeType.credentials.length > 0) {
		nodeType.credentials.forEach((cred) => {
			if (cred.displayOptions?.show) {
				Object.keys(cred.displayOptions.show).forEach((option) => {
					const nodeFieldsForName = nodeType.properties.filter((prop) => prop.name === option);
					if (nodeFieldsForName) {
						nodeFieldsForName.forEach((nodeField) => {
							if (
								!authFields.includes(nodeField) &&
								isNodeFieldMatchingNodeVersion(nodeField, nodeVersion)
							) {
								authFields.push(nodeField);
							}
						});
					}
				});
			}
		});
	}
	return authFields;
};

export const isNodeFieldMatchingNodeVersion = (
	nodeField: INodeProperties,
	nodeVersion: number | undefined,
) => {
	if (nodeVersion && nodeField.displayOptions?.show?.['@version']) {
		return nodeField.displayOptions.show['@version']?.includes(nodeVersion);
	}
	return true;
};

export const getCredentialsRelatedFields = (
	nodeType: INodeTypeDescription | null,
	credentialType: INodeCredentialDescription | null,
): INodeProperties[] => {
	let fields: INodeProperties[] = [];
	if (nodeType && credentialType?.displayOptions?.show) {
		Object.keys(credentialType.displayOptions.show).forEach((option) => {
			fields = fields.concat(nodeType.properties.filter((prop) => prop.name === option));
		});
	}
	return fields;
};

export const updateNodeAuthType = (node: INodeUi | null, type: string) => {
	if (!node) {
		return;
	}
	const nodeType = useNodeTypesStore().getNodeType(node.type, node.typeVersion);
	if (nodeType) {
		const nodeAuthField = getMainAuthField(nodeType);
		if (nodeAuthField) {
			const updateInformation = {
				name: node.name,
				properties: {
					parameters: {
						...node.parameters,
						[nodeAuthField.name]: type,
					},
				},
			};
			useWorkflowsStore().updateNodeProperties(updateInformation);
		}
	}
};

export const isNodeParameterRequired = (
	nodeType: INodeTypeDescription,
	parameter: INodeProperties,
): boolean => {
	if (!parameter.displayOptions?.show) {
		return true;
	}
	// If parameter itself contains 'none'?
	// Walk through dependencies and check if all their values are used in displayOptions
	Object.keys(parameter.displayOptions.show).forEach((name) => {
		const relatedField = nodeType.properties.find((prop) => {
			prop.name === name;
		});
		if (relatedField && !isNodeParameterRequired(nodeType, relatedField)) {
			return false;
		} else {
			return true;
		}
	});
	return true;
};

export const parseResourceMapperFieldName = (fullName: string) => {
	const match = fullName.match(RESOURCE_MAPPER_FIELD_NAME_REGEX);
	const fieldName = match ? match.pop() : fullName;

	return fieldName;
};

export const fieldCannotBeDeleted = (
	field: INodeProperties | ResourceMapperField,
	showMatchingColumnsSelector: boolean,
	resourceMapperMode = '',
	matchingFields: string[] = [],
): boolean => {
	const fieldIdentifier = 'id' in field ? field.id : field.name;
	return (
		(resourceMapperMode === 'add' && field.required === true) ||
		isMatchingField(fieldIdentifier, matchingFields, showMatchingColumnsSelector)
	);
};

export const isResourceMapperFieldListStale = (
	oldFields: ResourceMapperField[],
	newFields: ResourceMapperField[],
): boolean => {
	if (oldFields.length !== newFields.length) {
		return true;
	}

	// Create map for O(1) lookup
	const newFieldsMap = new Map(newFields.map((field) => [field.id, field]));

	// Check if any fields were removed or modified
	for (const oldField of oldFields) {
		const newField = newFieldsMap.get(oldField.id);

		// Field was removed
		if (!newField) {
			return true;
		}

		// Check if any properties changed
		if (
			oldField.displayName !== newField.displayName ||
			oldField.required !== newField.required ||
			oldField.defaultMatch !== newField.defaultMatch ||
			oldField.display !== newField.display ||
			oldField.canBeUsedToMatch !== newField.canBeUsedToMatch ||
			oldField.type !== newField.type
		) {
			return true;
		}
	}

	return false;
};

export const isMatchingField = (
	field: string,
	matchingFields: string[],
	showMatchingColumnsSelector: boolean,
): boolean => {
	const fieldName = parseResourceMapperFieldName(field);
	if (fieldName) {
		return showMatchingColumnsSelector && (matchingFields || []).includes(fieldName);
	}
	return false;
};

export const getThemedValue = <T extends string>(
	value: Themed<T> | undefined,
	theme: AppliedThemeOption = 'light',
): T | null => {
	if (!value) {
		return null;
	}

	if (typeof value === 'string') {
		return value;
	}

	return value[theme];
};
