import { atom } from 'jotai';

export type ActiveView = 'mail' | 'calendar' | 'contacts' | 'approvals' | 'activity' | 'settings';
export const activeViewAtom = atom<ActiveView>('mail');
