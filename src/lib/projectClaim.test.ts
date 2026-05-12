import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectOwnerFromClaimant,
  buildUnclaimedProjectOwner,
  findClaimableMemberForOwner,
  getClaimableMemberName,
} from './projectClaim';

test('getClaimableMemberName uses the display name without appending email', () => {
  assert.equal(getClaimableMemberName({
    uid: '1',
    displayName: 'Alba Holgado',
    email: 'albah@law.stanford.edu',
    status: 'active',
  }), 'Alba Holgado');
});

test('getClaimableMemberName does not expose full email when display name is missing', () => {
  assert.equal(getClaimableMemberName({
    uid: '2',
    displayName: '',
    email: 'whuggins@law.stanford.edu',
    status: 'active',
  }), 'Whuggins');
});

test('buildProjectOwnerFromClaimant stores a name and uid, not email text', () => {
  assert.deepEqual(buildProjectOwnerFromClaimant({
    uid: 'uid-123',
    displayName: 'Beth Williams',
    email: 'bwill@law.stanford.edu',
    status: 'active',
  }), {
    uid: 'uid-123',
    name: 'Beth Williams',
    initials: 'BW',
  });
});

test('buildUnclaimedProjectOwner clears claim identity', () => {
  assert.deepEqual(buildUnclaimedProjectOwner(), {
    name: 'Unclaimed',
    initials: 'UN',
  });
});

test('findClaimableMemberForOwner matches legacy owners stored as email', () => {
  const member = {
    uid: 'legacy-uid',
    displayName: '',
    email: 'legacy.user@law.stanford.edu',
    status: 'active',
  };

  assert.equal(findClaimableMemberForOwner({ name: 'legacy.user@law.stanford.edu', initials: 'LU' }, [member])?.uid, 'legacy-uid');
});
