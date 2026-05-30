import { atom } from 'jotai';

export type ActiveView = 'mail' | 'calendar' | 'contacts' | 'files' | 'approvals' | 'activity' | 'settings';
export const activeViewAtom = atom<ActiveView>('mail');
