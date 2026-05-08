<script lang="ts">
  import { onMount } from 'svelte';

  let installed = $state(false);

  let selectedImage = $state<string | null>(null);
  let file = $state<File | null>(null);

  let loading = $state(false);

  // Camera
  let showCamera = $state(false);

  let videoElement: HTMLVideoElement;
  let canvasElement: HTMLCanvasElement;

  let stream = $state<MediaStream | null>(null);

  let recipes = $state<
    {
      title: string;
      time: string;
      difficulty: string;
      ingredients: string[];
    }[]
  >([]);

  onMount(() => {
    const checkInstalled = () => {
      installed = window.matchMedia('(display-mode: standalone)').matches;
    };

    checkInstalled();

    window
      .matchMedia('(display-mode: standalone)')
      .addEventListener('change', checkInstalled);
  });

  function handleImageUpload(event: Event) {
    const target = event.currentTarget as HTMLInputElement;

    if (!target.files || target.files.length === 0) {
      return;
    }

    const pickedFile = target.files[0];

    file = pickedFile;

    if (selectedImage) {
      URL.revokeObjectURL(selectedImage);
    }

    selectedImage = URL.createObjectURL(pickedFile);

    console.log(selectedImage);
  }

  async function openCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment'
        },
        audio: false
      });

      showCamera = true;

      await tick();

      if (videoElement) {
        videoElement.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access denied:', err);
      alert('Unable to access camera');
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    showCamera = false;
  }

  async function capturePhoto() {
    if (!videoElement || !canvasElement) return;

    const context = canvasElement.getContext('2d');

    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    context?.drawImage(
      videoElement,
      0,
      0,
      canvasElement.width,
      canvasElement.height
    );

    const blob: Blob | null = await new Promise((resolve) => {
      canvasElement.toBlob(resolve, 'image/jpeg');
    });

    if (blob) {
      file = new File([blob], 'camera-photo.jpg', {
        type: 'image/jpeg'
      });

      selectedImage = URL.createObjectURL(blob);
    }

    stopCamera();
  }

  async function analyzeIngredients() {
    if (!file) return;

    loading = true;
    recipes = [];

    try {
      // ============================
      // Replace with your API call
      // ============================

      /*
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      recipes = data.recipes;
      */

      await new Promise((resolve) => setTimeout(resolve, 1800));

      recipes = [
        {
          title: 'Creamy Garlic Pasta',
          time: '20 mins',
          difficulty: 'Easy',
          ingredients: ['Garlic', 'Milk', 'Pasta', 'Cheese']
        },
        {
          title: 'Vegetable Fried Rice',
          time: '15 mins',
          difficulty: 'Easy',
          ingredients: ['Rice', 'Carrots', 'Eggs', 'Onion']
        }
      ];
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  import { tick } from 'svelte';
</script>

<svelte:head>
  <title>ReciPic</title>
</svelte:head>

<div class="app">
  <div class="bg-glow glow-1"></div>
  <div class="bg-glow glow-2"></div>

  <header class="hero">
    <div class="badge">
      {#if installed}
        📱 Installed App
      {:else}
        🌐 Web App
      {/if}
    </div>

    <h1>
      Reci<span>Pic</span>
    </h1>

    <p>
      Turn your Pantry into a Recipe
    </p>
  </header>

  <section class="upload-card">
    <div class="upload-top">
      <h2>Upload Ingredients</h2>
      <p>Take a photo or upload from gallery</p>
    </div>

    <!-- NO IMAGE YET -->
    {#if !selectedImage}
      <div class="upload-actions">
        <button class="camera-btn" onclick={openCamera}>
          📸 Open Camera
        </button>

        <label class="gallery-btn">
          🖼 Upload Image

          <input
            type="file"
            accept="image/*"
            onchange={handleImageUpload}
          />
        </label>
      </div>
    {/if}

    <!-- IMAGE PREVIEW -->
    {#if selectedImage}
      <div class="preview-section">
        <div class="preview-header">
          <h3>Your Ingredients</h3>

          <button
            class="remove-btn"
            onclick={() => {
              selectedImage = null;
              file = null;
              recipes = [];
            }}
          >
            ✕
          </button>
        </div>

        {#if selectedImage}
          <div class="preview-container">
            <img
              class="preview-image"
              src={selectedImage}
              alt="Selected ingredients"
            />
          </div>
        {/if}

        <!-- RETAKE / REUPLOAD -->
        <div class="replace-actions">
          <button
            class="secondary-btn"
            onclick={openCamera}
          >
            📸 Retake
          </button>

          <label class="secondary-btn upload-new">
            🖼 New Upload

            <input
              type="file"
              accept="image/*"
              onchange={handleImageUpload}
            />
          </label>
        </div>
      </div>
    {/if}

    <button
      class="analyze-btn"
      onclick={analyzeIngredients}
      disabled={!file || loading}
    >
      {#if loading}
        <div class="spinner"></div>
        Analyzing...
      {:else}
        Find Recipes
      {/if}
    </button>
  </section>


  {#if recipes.length > 0}
    <section class="results">
      <div class="results-header">
        <h2>Suggested Recipes</h2>
        <span>{recipes.length} found</span>
      </div>

      <div class="recipe-list">
        {#each recipes as recipe}
          <div class="recipe-card">
            <div class="recipe-image">
              🍽️
            </div>

            <div class="recipe-content">
              <h3>{recipe.title}</h3>

              <div class="recipe-meta">
                <span>{recipe.time}</span>
                <span>•</span>
                <span>{recipe.difficulty}</span>
              </div>

              <div class="ingredients">
                {#each recipe.ingredients as ingredient}
                  <div class="ingredient-pill">
                    {ingredient}
                  </div>
                {/each}
              </div>

              <button class="view-btn">
                View Recipe
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Camera Modal -->
  {#if showCamera}
    <div class="camera-modal">
      <div class="camera-container">
        <video
          bind:this={videoElement}
          autoplay
          playsinline
        ></video>

        <canvas
          bind:this={canvasElement}
          style="display:none;"
        ></canvas>

        <div class="camera-controls">
          <button
            class="close-btn"
            onclick={stopCamera}
          >
            Cancel
          </button>

          <button
            class="capture-btn"
            onclick={capturePhoto}
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    font-family:
      Inter,
      system-ui,
      sans-serif;
    background:
      radial-gradient(circle at top, #1f2937 0%, #0f172a 45%);
    color: white;
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    min-height: 100vh;
    padding: 1.2rem;
    position: relative;
    overflow-x: hidden;
  }

  .bg-glow {
    position: fixed;
    border-radius: 999px;
    filter: blur(100px);
    opacity: 0.2;
    z-index: 0;
  }

  .glow-1 {
    width: 250px;
    height: 250px;
    background: #22c55e;
    top: -60px;
    right: -80px;
  }

  .glow-2 {
    width: 220px;
    height: 220px;
    background: #f97316;
    bottom: -100px;
    left: -80px;
  }

  .hero,
  .upload-card,
  .results {
    position: relative;
    z-index: 2;
  }

  .hero {
    margin-bottom: 2rem;
  }

  .badge {
    display: inline-flex;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }

  h1 {
    margin: 0;
    font-size: 3rem;
    font-weight: 800;
    letter-spacing: -2px;
  }

  h1 span {
    color: #4ade80;
  }

  .hero p {
    margin-top: 1rem;
    color: rgba(255,255,255,0.7);
    max-width: 320px;
  }

  .upload-card {
    background: rgba(255,255,255,0.08);
    border-radius: 28px;
    padding: 1rem;
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.08);
  }

  .upload-top h2 {
    margin: 0;
  }

  .upload-top p {
    color: rgba(255,255,255,0.6);
    margin-top: 0.3rem;
    font-size: 0.9rem;
  }

/* ADD / REPLACE THESE STYLES */

.upload-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1rem;
}

.camera-btn,
.gallery-btn {
  flex: 1;
  border: none;
  border-radius: 18px;
  padding: 1rem;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  font-size: 0.95rem;
}

.camera-btn {
  background: linear-gradient(
    135deg,
    #22c55e,
    #16a34a
  );
  color: white;
}

.gallery-btn {
  background: rgba(255,255,255,0.08);
  color: white;
  position: relative;
  overflow: hidden;
}

.gallery-btn,
.upload-new {
  position: relative;
  overflow: hidden;
}


.gallery-btn input,
.upload-new input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* PREVIEW SECTION */

.preview-section {
  margin-top: 1rem;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
}

.preview-header h3 {
  margin: 0;
  font-size: 1rem;
}

.remove-btn {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: none;
  background: rgba(255,255,255,0.08);
  color: white;
  cursor: pointer;
  font-size: 1rem;
}

.preview-container {
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.08);
}

.preview-image {
  width: 100%;
  height: 320px;
  object-fit: cover;
  display: block;
}

/* RETAKE BUTTONS */

.replace-actions {
  display: flex;
  gap: 0.8rem;
  margin-top: 1rem;
}

.secondary-btn {
  flex: 1;
  border: none;
  border-radius: 16px;
  padding: 0.95rem;
  background: rgba(255,255,255,0.08);
  color: white;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}

.upload-new {
  position: relative;
  overflow: hidden;
}
  .analyze-btn {
    width: 100%;
    margin-top: 1rem;
    border: none;
    border-radius: 18px;
    padding: 1rem;
    font-size: 1rem;
    font-weight: 700;
    background: white;
    color: black;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.7rem;
  }

  .analyze-btn:disabled {
    opacity: 0.5;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid rgba(0,0,0,0.2);
    border-top: 2px solid black;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .results {
    margin-top: 1.5rem;
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .recipe-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 4rem;
  }

  .recipe-card {
    background: rgba(255,255,255,0.08);
    border-radius: 24px;
    overflow: hidden;
  }

  .recipe-image {
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    background: rgba(255,255,255,0.05);
  }

  .recipe-content {
    padding: 1rem;
  }

  .recipe-content h3 {
    margin: 0;
  }

  .recipe-meta {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.4rem;
    color: rgba(255,255,255,0.6);
    font-size: 0.85rem;
  }

  .ingredients {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .ingredient-pill {
    background: rgba(255,255,255,0.08);
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    font-size: 0.8rem;
  }

  .view-btn {
    width: 100%;
    margin-top: 1rem;
    border: none;
    border-radius: 14px;
    padding: 0.9rem;
    background: rgba(255,255,255,0.08);
    color: white;
    cursor: pointer;
  }

  /* CAMERA MODAL */

  .camera-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.9);
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .camera-container {
    width: 100%;
    height: 100%;
    position: relative;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .camera-controls {
    position: absolute;
    bottom: 2rem;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 1rem;
    padding: 0 1rem;
  }

  .capture-btn,
  .close-btn {
    border: none;
    border-radius: 999px;
    padding: 1rem 1.4rem;
    font-weight: 700;
    cursor: pointer;
  }

  .capture-btn {
    background: white;
    color: black;
  }

  .close-btn {
    background: rgba(255,255,255,0.15);
    color: white;
  }

  @media (min-width: 768px) {
    .app {
      max-width: 500px;
      margin: 0 auto;
    }
  }
</style>