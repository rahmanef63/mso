<script lang="ts">
  import Monitor from "../lib/Monitor.svelte";
  import "../styles.css";
</script>

<svelte:head><title>MSO | Svelte migration preview</title></svelte:head>
<a class="skip-link" href="#main-content">Skip to content</a>
<div class="workspace">
  <header class="workspace-header">
    <h1>MSO</h1><span>Isolated Svelte migration preview</span>
  </header>
  <main id="main-content" tabindex="-1">
    <Monitor />
  </main>
  <footer>Existing host API and device permissions. Production shell unchanged.</footer>
</div>
