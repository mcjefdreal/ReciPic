<script lang="ts">
  import { onMount } from 'svelte';
  import { tick } from 'svelte';

  let installed = $state(false);

  let selectedImage = $state<string | null>(null);
  let file = $state<File | null>(null);

  let loading = $state(false);
  let analyzing = $state(false);

  // Camera
  let showCamera = $state(false);

  let videoElement: HTMLVideoElement;
  let canvasElement: HTMLCanvasElement;

  let stream = $state<MediaStream | null>(null);


  let detectedIngredients = $state<Array<{ id: string; name: string; quantity: number; unit: string }>>([]);
  let showConfirmation = $state(false);
  let savingToPantry = $state(false);
  let pantrySaved = $state(false);


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

    detectedIngredients = [];
    showConfirmation = false;
    pantrySaved = false;
    recipes = [];
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

    detectedIngredients = [];
    showConfirmation = false;
    pantrySaved = false;
    recipes = [];

    stopCamera();
  }

  async function analyzeIngredients() {
    if (!file) return;

    analyzing = true;
    detectedIngredients = [];

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Analysis failed');
      }

      const data = await res.json();

      // Convert API response to editable format
      detectedIngredients = (data.ingredients || []).map((ing: { name: string; count: number }, i: number) => ({
        id: `ing-${i}-${Date.now()}`,
        name: ing.name,
        quantity: ing.count || 1,
        unit: 'piece'
      }));

      showConfirmation = true;
    } catch (err) {
      console.error('Analysis error:', err);
      alert('Failed to analyze image. Please try again.');
    } finally {
      analyzing = false;
    }
  }

  function updateQuantity(id: string, delta: number) {
    detectedIngredients = detectedIngredients.map(ing =>
      ing.id === id
        ? { ...ing, quantity: Math.max(0.5, ing.quantity + delta) }
        : ing
    );
  }

  function updateName(id: string, newName: string) {
    detectedIngredients = detectedIngredients.map(ing =>
      ing.id === id ? { ...ing, name: newName } : ing
    );
  }

  function removeIngredient(id: string) {
    detectedIngredients = detectedIngredients.filter(ing => ing.id !== id);
  }

  function addNewIngredient() {
    const newId = `ing-${Date.now()}`;
    detectedIngredients = [...detectedIngredients, {
      id: newId,
      name: '',
      quantity: 1,
      unit: 'piece'
    }];
  }

  async function saveToPantry() {
    if (detectedIngredients.length === 0) return;

    savingToPantry = true;

    try {
      const res = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: detectedIngredients.map(ing => ({
            name: ing.name || 'Unknown',
            quantity: ing.quantity,
            unit: ing.unit
          }))
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save');
      }

      pantrySaved = true;
      showConfirmation = false;

      // Now fetch recipes based on pantry items
      await findRecipes();
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save to pantry. Please try again.');
    } finally {
      savingToPantry = false;
    }
  }

  async function findRecipes() {
    loading = true;
    recipes = [];

    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const ingredientNames = detectedIngredients.map(i => i.name);

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
      ].filter(r =>
        r.ingredients.some(ing =>
          ingredientNames.some(detected =>
            ing.toLowerCase().includes(detected.toLowerCase()) ||
            detected.toLowerCase().includes(ing.toLowerCase())
          )
        )
      );

      if (recipes.length === 0) {
        recipes = [
          {
            title: 'Simple Stir Fry',
            time: '15 mins',
            difficulty: 'Easy',
            ingredients: ingredientNames.slice(0, 4)
          }
        ];
      }
    } catch (err) {
      console.error(err);
    } finally {
      loading = false;
    }
  }

  function resetAll() {
    selectedImage = null;
    file = null;
    detectedIngredients = [];
    showConfirmation = false;
    pantrySaved = false;
    recipes = [];
  }
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
            onclick={resetAll}
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

    {#if !showConfirmation && !pantrySaved}
      <button
        class="analyze-btn"
        onclick={analyzeIngredients}
        disabled={!file || analyzing}
      >
        {#if analyzing}
          <div class="spinner"></div>
          Analyzing...
        {:else}
          🔍 Detect Ingredients
        {/if}
      </button>
    {/if}
  </section>

  <!-- INGREDIENT CONFIRMATION SCREEN -->
  {#if showConfirmation}
    <section class="confirmation-card">
      <div class="confirmation-header">
        <h2>Confirm Ingredients</h2>
        <p>Review and adjust detected items</p>
      </div>

      <div class="ingredients-list">
        {#each detectedIngredients as ingredient (ingredient.id)}
          <div class="ingredient-item">
            <div class="ingredient-info">
              <input
                type="text"
                class="ingredient-name-input"
                value={ingredient.name}
                oninput={(e) => updateName(ingredient.id, e.currentTarget.value)}
                placeholder="Ingredient name"
              />
            </div>

            <div class="quantity-controls">
              <button
                class="qty-btn"
                onclick={() => updateQuantity(ingredient.id, -1)}
                aria-label="Decrease quantity"
              >
                −
              </button>

              <span class="quantity-value">
                {ingredient.quantity}
              </span>

              <button
                class="qty-btn"
                onclick={() => updateQuantity(ingredient.id, 1)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>

            <button
              class="delete-btn"
              onclick={() => removeIngredient(ingredient.id)}
              aria-label="Remove ingredient"
            >
              🗑️
            </button>
          </div>
        {/each}
      </div>

      <button
        class="add-ingredient-btn"
        onclick={addNewIngredient}
      >
        + Add Ingredient
      </button>

      <div class="confirmation-actions">
        <button
          class="secondary-btn"
          onclick={() => showConfirmation = false}
        >
          Cancel
        </button>

        <button
          class="save-btn"
          onclick={saveToPantry}
          disabled={detectedIngredients.length === 0 || savingToPantry}
        >
          {#if savingToPantry}
            <div class="spinner white"></div>
            Saving...
          {:else}
            💾 Save to Pantry
          {/if}
        </button>
      </div>
    </section>
  {/if}

  <!-- PANTRY SAVED MESSAGE -->
  {#if pantrySaved}
    <section class="success-card">
      <div class="success-icon">✅</div>
      <h3>Saved to Pantry!</h3>
      <p>Your ingredients have been added to your pantry.</p>
    </section>
  {/if}


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
  .results,
  .confirmation-card,
  .success-card {
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

  .spinner.white {
    border: 2px solid rgba(255,255,255,0.3);
    border-top: 2px solid white;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* CONFIRMATION CARD */
  .confirmation-card {
    background: rgba(255,255,255,0.08);
    border-radius: 28px;
    padding: 1.2rem;
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.08);
    margin-top: 1rem;
  }

  .confirmation-header h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .confirmation-header p {
    color: rgba(255,255,255,0.6);
    margin-top: 0.3rem;
    font-size: 0.9rem;
  }

  .ingredients-list {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .ingredient-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: rgba(0,0,0,0.2);
    padding: 0.7rem 0.9rem;
    border-radius: 16px;
  }

  .ingredient-info {
    flex: 1;
    min-width: 0;
  }

  .ingredient-name-input {
    width: 100%;
    background: transparent;
    border: none;
    color: white;
    font-size: 0.95rem;
    padding: 0.3rem 0;
    outline: none;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }

  .ingredient-name-input:focus {
    border-bottom-color: #4ade80;
  }

  .ingredient-name-input::placeholder {
    color: rgba(255,255,255,0.4);
  }

  .quantity-controls {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 0.3rem;
  }

  .qty-btn {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    border: none;
    background: rgba(255,255,255,0.1);
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .qty-btn:hover {
    background: rgba(255,255,255,0.2);
  }

  .quantity-value {
    min-width: 32px;
    text-align: center;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .delete-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: none;
    background: rgba(239,68,68,0.2);
    cursor: pointer;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .delete-btn:hover {
    background: rgba(239,68,68,0.3);
  }

  .add-ingredient-btn {
    width: 100%;
    margin-top: 0.8rem;
    padding: 0.8rem;
    border: 1px dashed rgba(255,255,255,0.3);
    border-radius: 14px;
    background: transparent;
    color: rgba(255,255,255,0.8);
    font-size: 0.9rem;
    cursor: pointer;
  }

  .add-ingredient-btn:hover {
    border-color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.05);
  }

  .confirmation-actions {
    display: flex;
    gap: 0.8rem;
    margin-top: 1rem;
  }

  .save-btn {
    flex: 1;
    border: none;
    border-radius: 16px;
    padding: 1rem;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
  }

  .save-btn:disabled {
    opacity: 0.5;
  }

  /* SUCCESS CARD */
  .success-card {
    background: rgba(34,197,94,0.15);
    border-radius: 28px;
    padding: 1.5rem;
    border: 1px solid rgba(34,197,94,0.3);
    margin-top: 1rem;
    text-align: center;
  }

  .success-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  .success-card h3 {
    margin: 0;
    font-size: 1.2rem;
  }

  .success-card p {
    margin: 0.5rem 0 0;
    color: rgba(255,255,255,0.7);
    font-size: 0.9rem;
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