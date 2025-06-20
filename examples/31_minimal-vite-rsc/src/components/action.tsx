let count = 0;

export function ServerCounter() {
  return (
    <form
      style={{ border: '3px green dashed', margin: '1em', padding: '1em' }}
      action={async () => {
        'use server';
        count += 1;
      }}
    >
      <button>server action counter: {count}</button>
    </form>
  );
}
