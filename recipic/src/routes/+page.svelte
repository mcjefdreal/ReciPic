<script lang="ts">
  import { onMount } from 'svelte';

  let installed = $state(false);

  let selectedImage = $state<string | null>(null);
  let file = $state<File | null>(null);

  let loading = $state(false);
  let analysisStep = $state<'idle' | 'analyzing' | 'saved'>('idle');

  // Detected ingredients from image analysis
  let detectedIngredients = $state<{ name: string; count: number }[]>([]);

  // Editable copy for the review modal
  let editableIngredients = $state<{ name: string; count: number }[]>([]);
  let showIngredientModal = $state(false);
  let newIngredientName = $state('');

  // Pantry loaded from DB
  let pantryItems = $state<{ id: number; name: string; quantity: number; unit: string | null; category: string | null }[]>([]);

  let showPantry = $state(false);
  let showRecipes = $state(false);
  let pantrySearch = $state('');

  // Grouped and filtered pantry for modal
  let pantryGroups = $derived.by(() => {
    const q = pantrySearch.toLowerCase();
    const filtered = q
      ? pantryItems.filter(i => i.name.toLowerCase().includes(q))
      : pantryItems;
    const groups: Record<string, typeof filtered> = {};
    for (const item of filtered) {
      const cat = item.category || 'Uncategorized';
      (groups[cat] ??= []).push(item);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  });
  // Camera
  let showCamera = $state(false);

  let videoElement: HTMLVideoElement;
  let canvasElement: HTMLCanvasElement;

  let stream = $state<MediaStream | null>(null);

  let recipes = $state<
    {
      id: number;
      name: string;
      description: string | null;
      ingredients: string | null;
      instructions: string | null;
      ingredientCount?: number;
      link?: string | null;
      matchCount: number;
      matches: string[];
      score?: number;
      reasoning?: string;
      distance?: number | null;
    }[]
  >([]);

  let recipeLoading = $state(false);

  onMount(() => {
    const checkInstalled = () => {
      installed = window.matchMedia('(display-mode: standalone)').matches;
    };

    checkInstalled();

    window
      .matchMedia('(display-mode: standalone)')
      .addEventListener('change', checkInstalled);

    loadPantry();
  });

  async function loadPantry() {
    try {
      const res = await fetch('/api/pantry');
      if (res.ok) {
        pantryItems = await res.json();
      }
    } catch (err) {
      console.error('Failed to load pantry:', err);
    }
  }

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

    // Reset analysis state on new image
    detectedIngredients = [];
    editableIngredients = [];
    analysisStep = 'idle';
    showIngredientModal = false;
    recipes = [];

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

    // Reset analysis state on new image
    detectedIngredients = [];
    editableIngredients = [];
    analysisStep = 'idle';
    showIngredientModal = false;
    recipes = [];

    stopCamera();
  }

  async function analyzeIngredients() {
    if (!file) return;

    loading = true;
    analysisStep = 'analyzing';
    detectedIngredients = [];
    recipes = [];

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Analyze failed: ${res.status}`);
      }

      const data = await res.json();
      detectedIngredients = data.ingredients || [];

      if (detectedIngredients.length > 0) {
        // Deep-copy ingredients for editing — user can modify before saving
        editableIngredients = detectedIngredients.map((ing: { name: string; count: number }) => ({
          name: ing.name,
          count: ing.count || 1
        }));
        analysisStep = 'detected';
        showIngredientModal = true;
      } else {
        analysisStep = 'idle';
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to analyze image');
      analysisStep = 'idle';
    } finally {
      loading = false;
    }
  }

  function updateIngredientCount(index: number, delta: number) {
    const next = editableIngredients[index].count + delta;
    if (next >= 1) editableIngredients[index].count = next;
  }

  function removeEditableIngredient(index: number) {
    editableIngredients = editableIngredients.filter((_, i) => i !== index);
  }

  function addEditableIngredient() {
    const name = newIngredientName.trim();
    if (!name) return;
    editableIngredients = [...editableIngredients, { name, count: 1 }];
    newIngredientName = '';
  }

  async function confirmIngredients() {
    if (editableIngredients.length === 0) {
      showIngredientModal = false;
      analysisStep = 'idle';
      return;
    }

    loading = true;
    try {
      const pantryRes = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: editableIngredients.map(ing => ({
            name: ing.name,
            quantity: ing.count
          }))
        })
      });

      if (pantryRes.ok) {
        await loadPantry();
        detectedIngredients = editableIngredients;
        analysisStep = 'saved';
        showIngredientModal = false;
      } else {
        throw new Error('Failed to save ingredients to pantry');
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to save ingredients');
    } finally {
      loading = false;
    }
  }

  function cancelIngredientEdit() {
    showIngredientModal = false;
    analysisStep = 'idle';
  }

  async function findRecipes() {
    recipeLoading = true;
    recipes = [];

    try {
      const res = await fetch('/api/recipes/search');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Search failed: ${res.status}`);
      }

      const data = await res.json();
      recipes = data.recipes || [];
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to find recipes');
    } finally {
      recipeLoading = false;
    }
  }

  async function clearPantry() {
    try {
      const res = await fetch('/api/pantry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true })
      });
      if (res.ok) {
        pantryItems = [];
        recipes = [];
      }
    } catch (err) {
      console.error('Failed to clear pantry:', err);
    }
  }

  async function removePantryItem(id: number) {
    try {
      const res = await fetch('/api/pantry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        pantryItems = pantryItems.filter((item) => item.id !== id);
      }
    } catch (err) {
      console.error('Failed to remove pantry item:', err);
    }
  }

  let expandedRecipe = $state<number | null>(null);

  function toggleDetails(recipe: typeof recipes[number]) {
    expandedRecipe = expandedRecipe === recipe.id ? null : recipe.id;
  }

  let debugExpanded = $state<Set<number>>(new Set());

  function toggleDebug(recipeId: number) {
    const next = new Set(debugExpanded);
    if (next.has(recipeId)) next.delete(recipeId);
    else next.add(recipeId);
    debugExpanded = next;
  }

  function openLink(link: string | null | undefined) {
    if (!link) return;
    const url = link.startsWith('http') ? link : `https://${link}`;
    window.open(url, '_blank');
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

    {#if pantryItems.length > 0 || recipes.length > 0}
      <div class="hero-actions">
        {#if pantryItems.length > 0}
          <button class="hero-btn" onclick={() => showPantry = true}>
            🧺 Pantry ({pantryItems.length})
          </button>
        {/if}
        {#if recipes.length > 0}
          <button class="hero-btn" onclick={() => showRecipes = true}>
            🍳 Recipes ({recipes.length})
          </button>
        {/if}
      </div>
    {/if}
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
              detectedIngredients = [];
              editableIngredients = [];
              analysisStep = 'idle';
              showIngredientModal = false;
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

      <!-- ANALYZE BUTTON -->
      {#if analysisStep !== 'saved' && analysisStep !== 'detected'}
        <button
          class="analyze-btn"
          onclick={analyzeIngredients}
          disabled={!file || loading}
        >
          {#if loading}
            <div class="spinner"></div>
            Analyzing...
          {:else}
            🔍 Analyze Ingredients
          {/if}
        </button>
      {/if}

      <!-- DETECTED INGREDIENTS -->
      {#if detectedIngredients.length > 0 && analysisStep === 'detected'}
        <div class="detected-section">
          <h4>Detected</h4>
          <div class="ingredients">
            {#each detectedIngredients as ing}
              <div class="ingredient-pill">
                {ing.name} {#if ing.count > 1}×{ing.count}{/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <!-- post-scan stuff -->
  {#if analysisStep === 'saved' && pantryItems.length > 0}
    <section class="actions-section">
      <button class="analyze-btn" onclick={() => showPantry = true}>
        🧺 View Pantry ({pantryItems.length})
      </button>
      <button class="analyze-btn find-btn" onclick={findRecipes} disabled={recipeLoading}>
        {#if recipeLoading}
          <div class="spinner"></div>
          Searching...
        {:else}
          🍳 Find Recipes
        {/if}
      </button>
    </section>
  {/if}

  <!-- RECIPE RESULTS -->
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
              <h3>{recipe.name}</h3>

              <div class="recipe-meta">
                {#if recipe.score !== undefined}
                  <span class="score-badge">
                    🎯 {Math.round(recipe.score * 100)}% match
                  </span>
                {:else}
                  <span>{recipe.matchCount} ingredient{recipe.matchCount === 1 ? '' : 's'} matched</span>
                {/if}
                {#if recipe.ingredientCount !== undefined}
                  <span class="ingredient-count">🧂 {recipe.ingredientCount} total</span>
                {/if}
                {#if recipe.link}
                  <button class="link-btn" onclick={() => openLink(recipe.link)} title="Open recipe source">
                    🔗
                  </button>
                {/if}
                <button
                  class="debug-btn"
                  class:debug-active={debugExpanded.has(recipe.id)}
                  onclick={() => toggleDebug(recipe.id)}
                  title="Debug ranking data"
                >
                  🐛
                </button>
              </div>

              {#if recipe.reasoning}
                <p class="recipe-reasoning">{recipe.reasoning}</p>
              {/if}

              {#if recipe.matches.length > 0}
                <div class="ingredients">
                  {#each recipe.matches as match}
                    <div class="ingredient-pill matched">
                      {match}
                    </div>
                  {/each}
                </div>
              {/if}

              {#if recipe.description}
                <p class="recipe-desc">{recipe.description}</p>
              {/if}

              <button class="view-btn" onclick={() => toggleDetails(recipe)}>
                {expandedRecipe === recipe.id ? 'Hide Details' : 'View Details'}
              </button>

              {#if expandedRecipe === recipe.id}
                <div class="recipe-details">
                  {#if recipe.ingredients}
                    <h4>Ingredients ({recipe.ingredientCount || recipe.ingredients.split(',').length})</h4>
                    <p class="recipe-desc">{recipe.ingredients}</p>
                  {:else}
                    <p class="recipe-desc">No ingredients listed.</p>
                  {/if}
                  {#if recipe.instructions}
                    <h4>Instructions</h4>
                    <p class="recipe-desc">{recipe.instructions}</p>
                  {:else}
                    <p class="recipe-desc">No instructions listed.</p>
                  {/if}
                </div>
              {/if}

              {#if debugExpanded.has(recipe.id)}
                <div class="debug-panel">
                  <h4>🐛 Debug: RAG Ranking</h4>
                  <div class="debug-grid">
                    <div class="debug-item">
                      <span class="debug-label">LLM Score</span>
                      <span class="debug-value">{recipe.score !== undefined ? Math.round(recipe.score * 100) + '%' : 'N/A'}</span>
                    </div>
                    <div class="debug-item">
                      <span class="debug-label">Vector Distance</span>
                      <span class="debug-value">{recipe.distance !== null && recipe.distance !== undefined ? recipe.distance.toFixed(4) : 'N/A'}</span>
                    </div>
                    <div class="debug-item">
                      <span class="debug-label">Matched</span>
                      <span class="debug-value">{recipe.matchCount} of {recipe.ingredientCount || '?'}</span>
                    </div>
                  </div>
                  {#if recipe.reasoning}
                    <div class="debug-item debug-wide">
                      <span class="debug-label">LLM Reasoning</span>
                      <span class="debug-value">{recipe.reasoning}</span>
                    </div>
                  {/if}
                  {#if recipe.matches.length > 0}
                    <div class="debug-item debug-wide">
                      <span class="debug-label">Matching Ingredients</span>
                      <span class="debug-value">{recipe.matches.join(', ')}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {:else if !recipeLoading && pantryItems.length > 0 && analysisStep === 'saved'}
    <section class="results empty">
      <p>No recipes match your pantry yet. Add more ingredients or import the recipe dataset.</p>
    </section>
  {/if}

  <!-- Ingredient Edit Modal -->
  {#if showIngredientModal}
    <div class="ingredient-modal">
      <div class="ingredient-modal-content">
        <div class="ingredient-modal-header">
          <h2>Review Ingredients</h2>
          <p>Edit, add, or remove before saving to pantry</p>
          <button class="modal-close" onclick={cancelIngredientEdit}>✕</button>
        </div>

        <div class="ingredient-modal-body">
          {#if editableIngredients.length === 0}
            <div class="ingredient-empty">
              <p>No ingredients to review.</p>
              <p>Add one below or cancel.</p>
            </div>
          {:else}
            <div class="ingredient-edit-list">
              {#each editableIngredients as ing, i}
                <div class="ingredient-edit-row">
                  <div class="ingredient-name-wrap">
                    <input
                      class="ingredient-name-input"
                      type="text"
                      bind:value={editableIngredients[i].name}
                    />
                  </div>
                  <div class="ingredient-qty-wrap">
                    <button
                      class="qty-btn"
                      onclick={() => updateIngredientCount(i, -1)}
                      disabled={ing.count <= 1}
                    >−</button>
                    <span class="qty-value">{ing.count}</span>
                    <button
                      class="qty-btn"
                      onclick={() => updateIngredientCount(i, 1)}
                    >+</button>
                  </div>
                  <button
                    class="ingredient-remove-btn"
                    onclick={() => removeEditableIngredient(i)}
                    title="Remove"
                  >✕</button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="ingredient-add-row">
            <input
              class="ingredient-add-input"
              type="text"
              placeholder="Add another ingredient..."
              bind:value={newIngredientName}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEditableIngredient(); } }}
            />
            <button
              class="ingredient-add-btn"
              onclick={addEditableIngredient}
              disabled={!newIngredientName.trim()}
            >+ Add</button>
          </div>
        </div>

        <div class="ingredient-modal-footer">
          <button class="secondary-btn cancel-btn" onclick={cancelIngredientEdit}>
            Cancel
          </button>
          <button
            class="analyze-btn save-btn"
            onclick={confirmIngredients}
            disabled={editableIngredients.length === 0 || loading}
          >
            {#if loading}
              <div class="spinner"></div>
              Saving...
            {:else}
              ✅ Add to Pantry
            {/if}
          </button>
        </div>
      </div>
    </div>
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

  <!-- PANTRY MODAL -->
  {#if showPantry}
    <div class="pantry-modal">
      <div class="pantry-modal-content">
        <div class="pantry-modal-header">
          <div class="pantry-modal-title">
            <h2>🧺 Pantry</h2>
            <span class="count-badge">{pantryItems.length}</span>
          </div>
          <button class="modal-close" onclick={() => showPantry = false}>✕</button>
        </div>

        <div class="pantry-search-wrap">
          <input class="pantry-search" type="text" placeholder="Search ingredients..." bind:value={pantrySearch} />
        </div>

        {#if pantryItems.length === 0}
          <div class="pantry-empty">
            <p>Your pantry is empty.</p>
            <p>Scan ingredients to get started.</p>
          </div>
        {:else}
          <div class="pantry-scroll">
            {#each Object.entries(pantryGroups) as [category, items]}
              <div class="pantry-group">
                <h3 class="pantry-group-title">{category}</h3>
                {#each items as item}
                  <div class="pantry-row">
                    <div class="pantry-row-info">
                      <span class="pantry-row-name">{item.name}</span>
                      <span class="pantry-row-qty">
                        {item.quantity}{#if item.unit} {item.unit}{/if}
                      </span>
                    </div>
                    <button class="pantry-row-remove" onclick={() => removePantryItem(item.id)}>✕</button>
                  </div>
                {/each}
              </div>
            {/each}
          </div>
        {/if}

        <div class="pantry-modal-footer">
          {#if pantryItems.length > 0}
            <button class="secondary-btn clear-all-btn" onclick={() => { clearPantry(); pantrySearch = ''; }}>Clear All</button>
            <button class="analyze-btn find-btn" onclick={() => { showPantry = false; findRecipes(); }}>
              🍳 Find Recipes
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- RECIPES MODAL -->
  {#if showRecipes}
    <div class="pantry-modal">
      <div class="pantry-modal-content">
        <div class="pantry-modal-header">
          <div class="pantry-modal-title">
            <h2>🍳 Recipes</h2>
            <span class="count-badge">{recipes.length}</span>
          </div>
          <button class="modal-close" onclick={() => showRecipes = false}>✕</button>
        </div>

        <div class="pantry-scroll">
          {#if recipes.length === 0}
            <div class="pantry-empty">
              <p>No recipes yet.</p>
              <p>Add pantry items and find recipes to get started.</p>
            </div>
          {:else}
            <div class="recipe-list modal-recipe-list">
              {#each recipes as recipe}
                <div class="recipe-card">
                  <div class="recipe-image">🍽️</div>
                  <div class="recipe-content">
                    <h3>{recipe.name}</h3>
                    <div class="recipe-meta">
                      {#if recipe.score !== undefined}
                        <span class="score-badge">🎯 {Math.round(recipe.score * 100)}% match</span>
                      {:else}
                        <span>{recipe.matchCount} matched</span>
                      {/if}
                      {#if recipe.ingredientCount !== undefined}
                        <span class="ingredient-count">🧂 {recipe.ingredientCount} total</span>
                      {/if}
                      {#if recipe.link}
                        <button class="link-btn" onclick={() => openLink(recipe.link)} title="Open recipe source">🔗</button>
                      {/if}
                      <button
                        class="debug-btn"
                        class:debug-active={debugExpanded.has(recipe.id)}
                        onclick={() => toggleDebug(recipe.id)}
                        title="Debug ranking data"
                      >
                        🐛
                      </button>
                    </div>
                    {#if recipe.reasoning}
                      <p class="recipe-reasoning">{recipe.reasoning}</p>
                    {/if}
                    <button class="view-btn" onclick={() => toggleDetails(recipe)}>
                      {expandedRecipe === recipe.id ? 'Hide Details' : 'View Details'}
                    </button>
                    {#if expandedRecipe === recipe.id}
                      <div class="recipe-details">
                        {#if recipe.ingredients}
                          <h4>Ingredients ({recipe.ingredientCount || recipe.ingredients.split(',').length})</h4>
                          <p class="recipe-desc">{recipe.ingredients}</p>
                        {:else}
                          <p class="recipe-desc">No ingredients listed.</p>
                        {/if}
                        {#if recipe.instructions}
                          <h4>Instructions</h4>
                          <p class="recipe-desc">{recipe.instructions}</p>
                        {:else}
                          <p class="recipe-desc">No instructions listed.</p>
                        {/if}
                      </div>
                    {/if}

                    {#if debugExpanded.has(recipe.id)}
                      <div class="debug-panel">
                        <h4>🐛 Debug: RAG Ranking</h4>
                        <div class="debug-grid">
                          <div class="debug-item">
                            <span class="debug-label">LLM Score</span>
                            <span class="debug-value">{recipe.score !== undefined ? Math.round(recipe.score * 100) + '%' : 'N/A'}</span>
                          </div>
                          <div class="debug-item">
                            <span class="debug-label">Vector Distance</span>
                            <span class="debug-value">{recipe.distance !== null && recipe.distance !== undefined ? recipe.distance.toFixed(4) : 'N/A'}</span>
                          </div>
                          <div class="debug-item">
                            <span class="debug-label">Matched</span>
                            <span class="debug-value">{recipe.matchCount} of {recipe.ingredientCount || '?'}</span>
                          </div>
                        </div>
                        {#if recipe.reasoning}
                          <div class="debug-item debug-wide">
                            <span class="debug-label">LLM Reasoning</span>
                            <span class="debug-value">{recipe.reasoning}</span>
                          </div>
                        {/if}
                        {#if recipe.matches.length > 0}
                          <div class="debug-item debug-wide">
                            <span class="debug-label">Matching Ingredients</span>
                            <span class="debug-value">{recipe.matches.join(', ')}</span>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="pantry-modal-footer">
          <button class="secondary-btn" onclick={() => showRecipes = false}>Close</button>
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

  .hero-actions {
    display: flex;
    gap: 0.8rem;
    margin-top: 1.2rem;
    flex-wrap: wrap;
  }

  .hero-btn {
    padding: 0.6rem 1.2rem;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.08);
    color: white;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
    backdrop-filter: blur(10px);
  }

  .hero-btn:hover {
    background: rgba(255,255,255,0.15);
    border-color: rgba(255,255,255,0.3);
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

  .find-btn {
    background: linear-gradient(135deg, #f97316, #ea580c);
    color: white;
  }

  .save-btn {
    background: linear-gradient(135deg, #22c55e, #16a34a);
    color: white;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid rgba(0,0,0,0.2);
    border-top: 2px solid black;
    animation: spin 0.8s linear infinite;
  }

  .find-btn .spinner,
  .save-btn .spinner {
    border: 2px solid rgba(255,255,255,0.3);
    border-top: 2px solid white;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .detected-section {
    margin-top: 1rem;
  }

  .detected-section h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: rgba(255,255,255,0.7);
  }

  .ingredients {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .ingredient-pill {
    background: rgba(255,255,255,0.08);
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .matched {
    background: rgba(34,197,94,0.2);
    color: #86efac;
  }

  .results {
    margin-top: 1.5rem;
  }

  .results-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .results.empty p {
    color: rgba(255,255,255,0.6);
    text-align: center;
    padding: 1rem;
  }

  .recipe-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 4rem;
  }

  .modal-recipe-list {
    padding-bottom: 1rem;
    padding-top: 0.5rem;
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

  .score-badge {
    background: rgba(34,197,94,0.2);
    color: #86efac;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .recipe-reasoning {
    margin: 0.5rem 0 0;
    color: rgba(255,255,255,0.5);
    font-size: 0.8rem;
    font-style: italic;
    line-height: 1.4;
  }

  .recipe-desc {
    margin: 0.5rem 0 0;
    color: rgba(255,255,255,0.6);
    font-size: 0.85rem;
    line-height: 1.4;
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

  .recipe-details {
    margin-top: 0.8rem;
    padding-top: 0.8rem;
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .recipe-details h4 {
    margin: 0.5rem 0 0.3rem;
    font-size: 0.85rem;
    color: rgba(255,255,255,0.5);
  }

  .debug-btn {
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    background: rgba(255,255,255,0.05);
    color: white;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .debug-btn:hover,
  .debug-active {
    background: rgba(250,204,21,0.15);
    border-color: rgba(250,204,21,0.3);
    color: #facc15;
  }

  .debug-panel {
    margin-top: 0.8rem;
    padding: 0.8rem;
    border: 1px solid rgba(250,204,21,0.15);
    border-radius: 14px;
    background: rgba(250,204,21,0.04);
  }

  .debug-panel h4 {
    margin: 0 0 0.6rem;
    font-size: 0.75rem;
    color: rgba(250,204,21,0.6);
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .debug-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .debug-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .debug-wide {
    grid-column: 1 / -1;
    margin-top: 0.3rem;
  }

  .debug-label {
    font-size: 0.65rem;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .debug-value {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.7);
    word-break: break-word;
  }

  /* INGREDIENT EDIT MODAL */

  .ingredient-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 1000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    opacity: 0;
    animation: fadeIn 0.2s ease forwards;
  }

  @keyframes fadeIn {
    to { opacity: 1; }
  }

  .ingredient-modal-content {
    background: #1a1f2e;
    border-radius: 28px 28px 0 0;
    width: 100%;
    max-width: 500px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.3s ease forwards;
  }

  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .ingredient-modal-header {
    padding: 1.5rem 1.2rem 0.5rem;
    position: relative;
  }

  .ingredient-modal-header h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .ingredient-modal-header p {
    margin: 0.3rem 0 0;
    color: rgba(255,255,255,0.5);
    font-size: 0.85rem;
  }

  .ingredient-modal-header .modal-close {
    position: absolute;
    top: 1.2rem;
    right: 1.2rem;
  }

  .ingredient-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .ingredient-empty {
    text-align: center;
    padding: 3rem 1rem;
    color: rgba(255,255,255,0.5);
  }

  .ingredient-empty p {
    margin: 0.3rem 0;
  }

  .ingredient-edit-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ingredient-edit-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .ingredient-name-wrap {
    flex: 1;
    min-width: 0;
  }

  .ingredient-name-input {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    background: rgba(255,255,255,0.06);
    color: white;
    font-size: 0.95rem;
    outline: none;
    text-transform: capitalize;
    box-sizing: border-box;
    transition: border-color 0.2s;
  }

  .ingredient-name-input:focus {
    border-color: rgba(74,222,128,0.5);
  }

  .ingredient-qty-wrap {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .qty-btn {
    width: 32px;
    height: 32px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    background: rgba(255,255,255,0.06);
    color: white;
    font-size: 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .qty-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.12);
  }

  .qty-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .qty-value {
    min-width: 24px;
    text-align: center;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .ingredient-remove-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 10px;
    background: rgba(239,68,68,0.15);
    color: #fca5a5;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .ingredient-remove-btn:hover {
    background: rgba(239,68,68,0.3);
  }

  .ingredient-add-row {
    display: flex;
    gap: 0.5rem;
    padding: 0.8rem 0;
    border-top: 1px solid rgba(255,255,255,0.06);
    margin-top: 0.4rem;
  }

  .ingredient-add-input {
    flex: 1;
    padding: 0.6rem 0.8rem;
    border: 1px dashed rgba(255,255,255,0.15);
    border-radius: 12px;
    background: rgba(255,255,255,0.04);
    color: white;
    font-size: 0.9rem;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;
  }

  .ingredient-add-input:focus {
    border-color: rgba(74,222,128,0.5);
    border-style: solid;
  }

  .ingredient-add-input::placeholder {
    color: rgba(255,255,255,0.3);
  }

  .ingredient-add-btn {
    padding: 0.6rem 1rem;
    border: none;
    border-radius: 12px;
    background: rgba(74,222,128,0.15);
    color: #86efac;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .ingredient-add-btn:hover:not(:disabled) {
    background: rgba(74,222,128,0.25);
  }

  .ingredient-add-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ingredient-modal-footer {
    display: flex;
    gap: 0.8rem;
    padding: 1rem 1.2rem 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  .ingredient-modal-footer .cancel-btn {
    flex-shrink: 0;
  }

  .ingredient-modal-footer .save-btn {
    flex: 1;
    margin: 0;
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

  .pantry-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .pantry-modal-content {
    background: #1a1f2e;
    border-radius: 28px 28px 0 0;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .pantry-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem 1.2rem 0.5rem;
  }

  .pantry-modal-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .pantry-modal-title h2 {
    margin: 0;
    font-size: 1.3rem;
  }

  .count-badge {
    background: rgba(34,197,94,0.2);
    color: #86efac;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .modal-close {
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 999px;
    background: rgba(255,255,255,0.08);
    color: white;
    cursor: pointer;
    font-size: 1rem;
  }

  .pantry-search-wrap {
    padding: 0.5rem 1.2rem;
  }

  .pantry-search {
    width: 100%;
    padding: 0.7rem 1rem;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    background: rgba(255,255,255,0.06);
    color: white;
    font-size: 0.9rem;
    outline: none;
    box-sizing: border-box;
  }

  .pantry-search::placeholder {
    color: rgba(255,255,255,0.3);
  }

  .pantry-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 1.2rem;
  }

  .pantry-group {
    margin-bottom: 1rem;
  }

  .pantry-group-title {
    margin: 0.5rem 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(255,255,255,0.4);
  }

  .pantry-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.7rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .pantry-row:last-child {
    border-bottom: none;
  }

  .pantry-row-info {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .pantry-row-name {
    font-size: 0.95rem;
    font-weight: 500;
    text-transform: capitalize;
  }

  .pantry-row-qty {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.06);
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
  }

  .pantry-row-remove {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 999px;
    background: rgba(239,68,68,0.15);
    color: #fca5a5;
    cursor: pointer;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pantry-empty {
    text-align: center;
    padding: 3rem 1rem;
    color: rgba(255,255,255,0.5);
  }

  .pantry-empty p {
    margin: 0.3rem 0;
  }

  .pantry-modal-footer {
    display: flex;
    gap: 0.8rem;
    padding: 1rem 1.2rem 1.5rem;
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  .pantry-modal-footer .find-btn {
    flex: 1;
    margin: 0;
  }

  .clear-all-btn {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .actions-section {
    display: flex;
    gap: 0.8rem;
    margin-top: 1.5rem;
  }

  .actions-section .analyze-btn {
    flex: 1;
    margin: 0;
  }
</style>
