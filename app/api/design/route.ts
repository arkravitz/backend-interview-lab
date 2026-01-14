import { handleDesign } from '@/lib/design-grader';
export async function POST(request: Request) {
  return handleDesign(request);
}
