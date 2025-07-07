import sqlite3
import torch
from sentence_transformers import SentenceTransformer
import numpy as np
from tqdm import tqdm
import os
import sqlite_vec

# --- Configuration ---
DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'products.db')
MODEL_NAME = 'all-MiniLM-L6-v2'
ENCODE_BATCH_SIZE = 128      # For sentence-transformers model.encode()
PROCESS_BATCH_SIZE = 25000  # For fetching products from the database

def check_gpu():
    """Checks if a GPU is available and prints CUDA information."""
    print(f"PyTorch version: {torch.__version__}")
    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        print(f"CUDA is available. Using GPU: {device_name}")
        return "cuda"
    else:
        print("CUDA not available. Using CPU.")
        return "cpu"

def setup_database(conn):
    """Sets up the database by loading extensions and creating tables."""
    print("Loading sqlite-vec extension...")
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    print("Extension loaded.")

    cursor = conn.cursor()

    # Add embedding column to products table if it doesn't exist
    try:
        cursor.execute("ALTER TABLE products ADD COLUMN embedding BLOB")
        print("Added 'embedding' column to 'products' table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("'embedding' column already exists in 'products' table.")
        else:
            raise e
    
    # Get embedding dimension from a dummy model call
    dummy_model = SentenceTransformer(MODEL_NAME)
    embedding_dim = dummy_model.get_sentence_embedding_dimension()
    print(f"Detected embedding dimension: {embedding_dim}")

    # Create the virtual table for vector search
    print("Creating virtual table 'vec_products' for vector search...")
    create_virtual_table_sql = f"""
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_products USING vec0(
        embedding float[{embedding_dim}]
    );
    """
    cursor.execute(create_virtual_table_sql)
    print("Virtual table 'vec_products' is ready.")

    print("Creating index for faster fetching of products without embeddings...")
    # This partial index helps to quickly find products that need embeddings.
    # It only includes rows where an embedding is missing and search_text is present.
    create_index_sql = """
    CREATE INDEX IF NOT EXISTS idx_products_pending_embedding
    ON products (id)
    WHERE embedding IS NULL AND search_text IS NOT NULL AND search_text != ''
    """
    cursor.execute(create_index_sql)
    print("Index for pending embeddings is ready.")

    conn.commit()


def fetch_product_batch(conn, batch_size):
    """Fetches a batch of products that don't have an embedding yet."""
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    print(f"Fetching a batch of up to {batch_size} products without embeddings...")
    # Select products that have a search_text but no embedding yet
    cursor.execute("""
        SELECT id, search_text FROM products 
        WHERE search_text IS NOT NULL AND search_text != '' AND embedding IS NULL
        LIMIT ?
    """, (batch_size,))
    products = cursor.fetchall()
    print(f"Found {len(products)} products in this batch.")
    return products

def generate_embeddings(products, model, device):
    """Generates embeddings for a list of products."""
    if not products:
        print("No products to process.")
        return np.array([])

    # Extract the text from products, handling potential None values
    sentences = [p['search_text'] for p in products]
    
    print(f"Generating embeddings for {len(sentences)} sentences using model '{MODEL_NAME}'...")
    embeddings = model.encode(
        sentences,
        batch_size=ENCODE_BATCH_SIZE,
        show_progress_bar=True,
        device=device,
        convert_to_numpy=True
    ).astype(np.float32) # Ensure it's float32 for sqlite-vec
    return embeddings

def save_embeddings(conn, products, embeddings):
    """Saves the generated embeddings to the database."""
    if len(products) == 0:
        return
        
    print(f"Saving {len(embeddings)} embeddings to the 'products' table...")
    cursor = conn.cursor()
    
    update_data = [(embedding.tobytes(), p['id']) for p, embedding in zip(products, embeddings)]
    
    cursor.executemany("UPDATE products SET embedding = ? WHERE id = ?", update_data)
    conn.commit()
    print("Embeddings saved to 'products' table.")

    # Now, populate the virtual table in batches
    print("Populating 'vec_products' virtual table...")
    product_ids = [p['id'] for p in products]
    batch_size = 500  # Stay safely under the 999 limit

    total_populated = 0
    for i in tqdm(range(0, len(product_ids), batch_size), desc="Populating virtual table"):
        batch_ids = product_ids[i:i + batch_size]
        placeholders = ','.join('?' for _ in batch_ids)
        sql = f"""
            INSERT INTO vec_products(rowid, embedding)
            SELECT p.rowid, p.embedding
            FROM products p
            WHERE p.id IN ({placeholders})
        """
        cursor.execute(sql, batch_ids)
        total_populated += cursor.rowcount
    
    conn.commit()
    print(f"Successfully populated 'vec_products' with {total_populated} new vectors.")


def main():
    """Main function to run the embedding generation process."""
    print("--- Starting Embedding Generation ---")

    # 1. Check for GPU
    device = check_gpu()

    # 2. Connect to DB and set it up
    try:
        with sqlite3.connect(DB_PATH) as conn:
            setup_database(conn)

            # 3. Load the sentence transformer model once
            print(f"Loading model '{MODEL_NAME}' onto device '{device}'...")
            model = SentenceTransformer(MODEL_NAME, device=device)

            total_processed = 0
            while True:
                print(f"\n--- Processing new batch (Total processed so far: {total_processed}) ---")
                
                # 4. Fetch a batch of products
                products = fetch_product_batch(conn, PROCESS_BATCH_SIZE)
                if not products:
                    print("No more products to embed. All products are up to date.")
                    break

                # 5. Generate embeddings for the batch
                embeddings = generate_embeddings(products, model, device)

                # 6. Save embeddings to the database for the batch
                save_embeddings(conn, products, embeddings)

                total_processed += len(products)
                print(f"Batch complete. Total products processed: {total_processed}")


    except (FileNotFoundError, sqlite3.Error) as e:
        print(f"A database error occurred: {e}")
        return

    # 7. Report results
    print("\n--- Embedding Generation and Storage Complete ---")
    print(f"Finished processing all batches.")

if __name__ == "__main__":
    main() 