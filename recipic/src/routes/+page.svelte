<script lang="ts">
  import { onMount } from 'svelte';

  let installed = false;

  onMount(() => {
    const checkInstalled = () => {
      installed = window.matchMedia('(display-mode: standalone)').matches;
    };

    checkInstalled();

    window.matchMedia('(display-mode: standalone)')
      .addEventListener('change', checkInstalled);
  });
</script>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
    font-family: system-ui, sans-serif;
    text-align: center;
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  p {
    opacity: 0.7;
    margin-bottom: 2rem;
  }

  .card {
    padding: 1.5rem;
    border-radius: 1rem;
    box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    margin-bottom: 1.5rem;
    width: 100%;
    max-width: 400px;
  }

  button {
    padding: 0.75rem 1.25rem;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
    font-size: 1rem;
  }

  .primary {
    background: black;
    color: white;
  }

  .secondary {
    background: #eee;
  }
</style>

<div class="container">
  <h1>ReciPic</h1>
  <p>Your app is installable, fast, and offline-ready.</p>

  <div class="card">
    <h2>Status</h2>
    {#if installed}
      <p>Running as installed app</p>
    {:else}
      <p>🌐 Running in browser</p>
    {/if}
  </div>

  <div class="card">
    <h2>Features</h2>
    <ul style="text-align:left;">
      <li>⚡ Fast loading</li>
      <li>📱 Installable</li>
      <li>🔌 Offline support</li>
    </ul>
  </div>

  <div class="card">
    <h2>Try it</h2>
    <button class="primary" on:click={() => alert('This can be your main action!')}>
      Get Started
    </button>
  </div>

  <div class="card">
    <h2>Next Steps</h2>
    <button class="secondary">Add Auth</button>
    <button class="secondary" style="margin-left: 0.5rem;">Connect API</button>
  </div>
</div>