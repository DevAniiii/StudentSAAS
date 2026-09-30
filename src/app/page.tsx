import { redirect } from "next/navigation";
import { getShellContext } from "@/server/context";

/**
 * The root.
 *
 * The portal has one front door, and it is not `/`. `/today` is the signed-in
 * home; `/login` is everything else. So `/` is a pure router with no content of
 * its own — a request that arrives here has said "I don't know where I am yet",
 * and the only honest response is to put the visitor where they belong.
 *
 * The session is resolved here rather than redirecting unconditionally to
 * `/today` and letting the shell layout bounce them onward. It costs one query,
 * which `getShellContext` has already warmed for nothing else at this point, and
 * it saves an anonymous visitor a redirect they would have followed straight
 * into a second one.
 *
 * `redirect()` throws, so the return type is `never` and no `return` follows.
 */
export default async function RootPage(): Promise<never> {
  const context = await getShellContext();
  redirect(context ? "/today" : "/login");
}
