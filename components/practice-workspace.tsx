'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { PythonCode } from '@/components/python-code';
import { AICoach, type CoachHandle } from '@/components/ai-coach';
import { FormattedText, InlineText } from '@/components/formatted-text';
import { DifficultyBadge } from '@/components/difficulty-badge';
import {
  DesignFlow,
  DesignProbes,
  DesignRubric,
  DesignScorecard,
  DesignSolution,
} from '@/components/design-interview';
import { DESIGN_SECTIONS, sectionById } from '@/lib/design';
import { acceptEdit, type Proposal } from '@/lib/review';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { verdict, type RunResult, type Submission } from '@/lib/submissions';
import type { Draft } from '@/lib/practice';
import coding from '@/app/data/coding.json';
import followups from '@/app/data/followups.json';
import designs from '@/app/data/design.json';
import designAnswers from '@/app/data/design-answers.json';
import contentData from '@/app/data/problem-content.json';
import {
  BookOpen,
  FileText,
  History,
  Code2,
  Bot,
  Lightbulb,
  Wand2,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gauge,
  RotateCcw,
  Check,
  X,
  Copy,
} from 'lucide-react';

type ProblemContent = {
  overview: string;
  task: string;
  requirements: string[];
  examples: { code: string; output: string; explanation: string }[];
  approach: string;
  interface?: string[];
  note?: string;
};
const contents: Record<string, ProblemContent> = contentData;
type Props = {
  stage: string;
  onStage: (s: 'base' | 'followup') => void;
  mock: boolean;
  setMock: (v: boolean) => void;
  /** Editor assistance: completions and auto-closing brackets. */
  assist: boolean;
  setAssist: (v: boolean) => void;
  id: string;
  track: string;
  draft: Draft;
  loaded: boolean;
  apiKey: string;
  dark: boolean;
  submissions: Submission[];
  onPatch: (p: Partial<Draft>) => void;
  onSubmit: (s: Submission) => void;
  onSettings: () => void;
  onNavigate: (id: string) => void;
  onLibrary: () => void;
  seconds: number;
  running: boolean;
  onClockToggle: () => void;
  onClockReset: () => void;
  stdin: string;
  onStdin: (v: string) => void;
};
export function PracticeWorkspace(props: Props) {
  return <PracticeSession key={props.id + props.stage} {...props} />;
}
