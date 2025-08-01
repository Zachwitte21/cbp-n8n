<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from '@n8n/i18n';
import { ResourceType, splitName } from '@/utils/projects.utils';
import type { Project } from '@/types/projects.types';
import { ProjectTypes } from '@/types/projects.types';
import type { CredentialsResource, FolderResource, WorkflowResource } from '@/Interface';
import { VIEWS } from '@/constants';
import { type IconOrEmoji, isIconOrEmoji } from '@n8n/design-system/components/N8nIconPicker/types';

type Props = {
	resource: WorkflowResource | CredentialsResource | FolderResource;
	resourceType: ResourceType;
	resourceTypeLabel: string;
	personalProject: Project | null;
	showBadgeBorder?: boolean;
};

const enum ProjectState {
	SharedPersonal = 'shared-personal',
	SharedOwned = 'shared-owned',
	Owned = 'owned',
	Personal = 'personal',
	Team = 'team',
	SharedTeam = 'shared-team',
	Unknown = 'unknown',
}

const props = withDefaults(defineProps<Props>(), {
	showBadgeBorder: true,
});

const i18n = useI18n();

const isShared = computed(() => {
	return 'sharedWithProjects' in props.resource && props.resource.sharedWithProjects?.length;
});

const projectState = computed(() => {
	if (
		(props.resource.homeProject &&
			props.personalProject &&
			props.resource.homeProject.id === props.personalProject.id) ||
		!props.resource.homeProject
	) {
		if (isShared.value) {
			return ProjectState.SharedOwned;
		}
		return ProjectState.Owned;
	} else if (props.resource.homeProject?.type !== ProjectTypes.Team) {
		if (isShared.value) {
			return ProjectState.SharedPersonal;
		}
		return ProjectState.Personal;
	} else if (props.resource.homeProject?.type === ProjectTypes.Team) {
		if (isShared.value) {
			return ProjectState.SharedTeam;
		}
		return ProjectState.Team;
	}
	return ProjectState.Unknown;
});

const numberOfMembersInHomeTeamProject = computed(() =>
	'sharedWithProjects' in props.resource ? (props.resource.sharedWithProjects?.length ?? 0) : 0,
);

const badgeText = computed(() => {
	if (
		projectState.value === ProjectState.Owned ||
		projectState.value === ProjectState.SharedOwned
	) {
		return i18n.baseText('projects.menu.personal');
	} else {
		const { name, email } = splitName(props.resource.homeProject?.name ?? '');
		return name ?? email ?? '';
	}
});

const badgeIcon = computed<IconOrEmoji>(() => {
	switch (projectState.value) {
		case ProjectState.Owned:
		case ProjectState.SharedOwned:
		case ProjectState.Personal:
		case ProjectState.SharedPersonal:
			return { type: 'icon', value: 'user' };
		case ProjectState.Team:
		case ProjectState.SharedTeam:
			return isIconOrEmoji(props.resource.homeProject?.icon)
				? props.resource.homeProject?.icon
				: { type: 'icon', value: 'layers' };
		default:
			return { type: 'icon', value: 'layers' };
	}
});
const badgeTooltip = computed(() => {
	switch (projectState.value) {
		case ProjectState.SharedOwned:
			return i18n.baseText('projects.badge.tooltip.sharedOwned', {
				interpolate: {
					resourceTypeLabel: props.resourceTypeLabel,
					count: numberOfMembersInHomeTeamProject.value,
				},
			});
		case ProjectState.SharedPersonal:
			return i18n.baseText('projects.badge.tooltip.sharedPersonal', {
				interpolate: {
					resourceTypeLabel: props.resourceTypeLabel,
					name: badgeText.value,
					count: numberOfMembersInHomeTeamProject.value,
				},
			});
		case ProjectState.Personal:
			return i18n.baseText('projects.badge.tooltip.personal', {
				interpolate: {
					resourceTypeLabel: props.resourceTypeLabel,
					name: badgeText.value,
				},
			});
		case ProjectState.Team:
			return i18n.baseText('projects.badge.tooltip.team', {
				interpolate: {
					resourceTypeLabel: props.resourceTypeLabel,
					name: badgeText.value,
				},
			});
		case ProjectState.SharedTeam:
			return i18n.baseText('projects.badge.tooltip.sharedTeam', {
				interpolate: {
					resourceTypeLabel: props.resourceTypeLabel,
					name: badgeText.value,
					count: numberOfMembersInHomeTeamProject.value,
				},
			});
		default:
			return '';
	}
});
const projectLocation = computed(() => {
	if (
		projectState.value !== ProjectState.Personal &&
		projectState.value !== ProjectState.SharedPersonal &&
		props.resource.homeProject?.id &&
		props.resourceType === ResourceType.Workflow
	) {
		return {
			name: VIEWS.PROJECTS_WORKFLOWS,
			params: { projectId: props.resource.homeProject.id },
		};
	}
	return null;
});
</script>
<template>
	<div :class="{ [$style.wrapper]: true, [$style['no-border']]: showBadgeBorder }" v-bind="$attrs">
		<N8nTooltip
			v-if="badgeText"
			:disabled="!badgeTooltip || numberOfMembersInHomeTeamProject !== 0"
			placement="top"
		>
			<N8nBadge
				:class="[$style.badge, $style.projectBadge]"
				theme="tertiary"
				data-test-id="card-badge"
				:show-border="showBadgeBorder"
			>
				<ProjectIcon :icon="badgeIcon" :border-less="true" size="mini" />
				<router-link v-if="projectLocation" :to="projectLocation">
					<span v-n8n-truncate:20="badgeText" />
				</router-link>
				<span v-else v-n8n-truncate:20="badgeText" />
			</N8nBadge>
			<template #content>
				{{ badgeTooltip }}
			</template>
		</N8nTooltip>
		<slot />
		<N8nTooltip
			v-if="numberOfMembersInHomeTeamProject"
			:disabled="!badgeTooltip || numberOfMembersInHomeTeamProject === 0"
			placement="top"
		>
			<div :class="$style['count-badge']" theme="tertiary" bold>
				+{{ numberOfMembersInHomeTeamProject }}
			</div>
			<template #content>
				{{ badgeTooltip }}
			</template>
		</N8nTooltip>
	</div>
</template>

<style lang="scss" module>
.wrapper {
	display: flex;
	align-items: center;
	border: var(--border-base);
	border-radius: var(--border-radius-base);

	&.no-border {
		border: none;
	}
}

.badge {
	padding: var(--spacing-4xs) var(--spacing-2xs);
	background-color: var(--color-background-xlight);
	border-color: var(--color-foreground-base);

	z-index: 1;
	position: relative;
	height: 23px;
	:global(.n8n-text),
	a {
		color: var(--color-text-base);
	}
}

.projectBadge {
	& > span {
		display: flex;
		gap: var(--spacing-3xs);
	}
}

.count-badge {
	font-size: var(--font-size-2xs);
	padding: var(--spacing-4xs) var(--spacing-3xs);
	color: var(--color-text-base);
	border-left: var(--border-base);
	line-height: var(--font-line-height-regular);
}
</style>
