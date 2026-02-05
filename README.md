# svelte-ssr-cookies

A small library for **typed, schema-driven cookie management** in SvelteKit with SSR support.

- Extract only the cookies defined in your schema on the server
- Pass them to the client without prop drilling
- Reactive, schema-validated cookies on the client
- Supports automatic persistence and optional cookie attributes

---

## Installation

```bash
npm install svelte-ssr-cookies

# or with Bun

bun add svelte-ssr-cookies
```

---

## Features

- Server: `pickCookies` — filters cookies by schema
- Client: `useCookies` — reactive proxy for schema-defined cookies
- Validation against a standard schema (`StandardSchemaV1`)
- Automatic JSON parsing/stringifying
- Optional cookie attributes (`expires`, `path`, `domain`, `secure`, `sameSite`)

---

## Server Usage

In your `+layout.server.ts` or any load function:

```ts
import { pickCookies } from '@svelte-ssr-cookies/server';
import { schema } from '$lib/schemas/cookies';

import type { LayoutServerLoad } from './$types';

export const load = (async ({ cookies }) => {
	// Pick only the cookies defined in the schema
	const serverCookies = pickCookies(cookies, schema);

	return {
		cookies: serverCookies
	};
}) satisfies LayoutServerLoad;
```

This ensures that only cookies defined in your schema are sent to the client.

---

## Client Usage

In a layout page:

```svelte
<script lang="ts">
	import type { LayoutProps } from './$types';

	import { setContext } from 'svelte';
	import { useCookies } from '@svelte-ssr-cookies/client';
	import { schema } from '$lib/schemas/cookies';

	// cookies returned from server load function
	let { data, children }: LayoutProps = $props();

	// Create reactive cookies proxy
	const cookies = useCookies(schema, data.cookies);

	// Provide in this context
	setContext('cookies', cookies);

	// Read/write automatically reactive
	$inspect(cookies.state);
	cookies.state = false; // persisted automatically
</script>

{@render children?.()}
```

Anywhere in this layout subtree, you can inject the cookies from context:

```ts
import { getContext } from 'svelte';
const cookies = getContext('cookies');
$inspect(cookies.state); // reactive
```

---

## Cookie Attributes (Optional)

You can set cookies with specific options using `update`:

```ts
cookies.update('state', true, {
	expires: 7, // 7 days
	path: '/',
	secure: true,
	sameSite: 'lax'
});
```

---

## Schema Example

```ts
import z from 'zod';

export const schema = z.object({
	state: z.boolean().default(true)
});
```

> ⚠️ Each schema entry **requires a default value**; entries without defaults will be skipped by the library.

---

## Advanced: Reactivity in Layout

You can bind reactive cookies directly to UI components. For example:

```svelte
<script lang="ts">
	import { getContext } from 'svelte';
	const cookies = getContext('cookies');
</script>

<label>
	<input type="checkbox" bind:checked={cookies.state} />
	State cookie
</label>

<p>
	Current state: {cookies.state ? 'Active' : 'Inactive'}
</p>
```

Changes to `cookies.state` automatically:

- Update the cookie in the browser
- Trigger reactivity in Svelte components
- No prop drilling required

This makes cookies behave like reactive Svelte stores throughout the layout subtree.
