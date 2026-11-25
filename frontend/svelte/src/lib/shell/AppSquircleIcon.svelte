<script lang="ts">
  import { resolveAppIcon } from "./app-icons.ts";
  import type { ChromeProfile } from "./chrome-profile.ts";

  let {
    app,
    chrome = "macos",
    radius = "23%",
    alt = "",
  }: {
    app: string;
    chrome?: ChromeProfile;
    radius?: string;
    alt?: string;
  } = $props();

  let visual = $derived(resolveAppIcon(app, chrome));
  let failedSrc = $state<string | null>(null);
  let showImage = $derived(Boolean(visual.image) && failedSrc !== visual.image);

  function handleImgError() {
    failedSrc = visual.image;
  }
</script>

<span
  class="aos-squircle"
  style={`--squircle-r: ${radius}; background: ${visual.gradient};`}
  data-app-icon={app}
>
  {#if showImage && visual.image}
    <img
      class="aos-squircle-img"
      src={visual.image}
      {alt}
      loading="lazy"
      draggable="false"
      onerror={handleImgError}
    />
  {:else}
    <span class="aos-squircle-mono" aria-hidden="true">{visual.monogram}</span>
  {/if}
</span>

<style>
  .aos-squircle {
    width: 100%;
    height: 100%;
    border-radius: var(--squircle-r, 23%);
    overflow: hidden;
    display: grid;
    place-items: center;
    position: relative;
    color: #ffffff;
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.34),
      inset 0 -0.5px 0 rgba(0, 0, 0, 0.16);
    user-select: none;
  }

  .aos-squircle-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .aos-squircle-mono {
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1;
  }
</style>
