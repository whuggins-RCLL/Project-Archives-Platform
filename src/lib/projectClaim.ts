import { Project } from '../types';

export interface ClaimableMember {
  uid: string;
  displayName: string;
  email: string;
  status: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeForCompare(value: string | undefined): string {
  return normalizeWhitespace(value ?? '').toLowerCase();
}

function nameFromEmailLocalPart(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const spaced = localPart.replace(/[._-]+/g, ' ').trim();
  if (!spaced) return '';

  return spaced
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getClaimableMemberName(member: ClaimableMember): string {
  const displayName = normalizeWhitespace(member.displayName);
  const email = normalizeWhitespace(member.email);

  if (displayName && displayName.toLowerCase() !== email.toLowerCase() && !EMAIL_PATTERN.test(displayName)) {
    return displayName;
  }

  const emailName = nameFromEmailLocalPart(email);
  if (emailName) return emailName;

  if (displayName) {
    return displayName.split('@')[0] ?? displayName;
  }

  return 'Unnamed member';
}

export function getOwnerInitials(name: string): string {
  const initials = normalizeWhitespace(name)
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || 'NA';
}

export function buildProjectOwnerFromClaimant(member: ClaimableMember): Project['owner'] {
  const name = getClaimableMemberName(member);
  return {
    uid: member.uid,
    name,
    initials: getOwnerInitials(name),
  };
}

export function buildUnclaimedProjectOwner(): Project['owner'] {
  return {
    name: 'Unclaimed',
    initials: 'UN',
  };
}

export function findClaimableMemberForOwner(
  owner: Project['owner'] | undefined,
  members: ClaimableMember[],
): ClaimableMember | undefined {
  if (!owner) return undefined;

  const ownerUid = 'uid' in owner && typeof owner.uid === 'string' ? owner.uid : '';
  if (ownerUid) {
    const uidMatch = members.find((member) => member.uid === ownerUid);
    if (uidMatch) return uidMatch;
  }

  const ownerName = normalizeForCompare(owner.name);
  if (!ownerName || ownerName === 'unclaimed') return undefined;

  return members.find((member) => (
    normalizeForCompare(getClaimableMemberName(member)) === ownerName ||
    normalizeForCompare(member.displayName) === ownerName ||
    normalizeForCompare(member.email) === ownerName
  ));
}
