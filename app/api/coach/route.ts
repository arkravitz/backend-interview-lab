import { handleCoach } from '@/lib/coach';
export async function POST(request: Request) {
  return handleCoach(request);
}
