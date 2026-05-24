import { atom } from 'jotai';

export type ActiveView = 'mail' | 'approvals' | 'activity' | 'settings';
export const activeViewAtom = atom<ActiveView>('mail');
