import chromadb
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Any
import os

class VectorStore:
    def __init__(self, persist_directory="./vector_db"):
        # 确保目录存在
        os.makedirs(persist_directory, exist_ok=True)
        # 初始化 Chroma DB
        self.client = chromadb.PersistentClient(path=persist_directory)
        # 选择或创建集合
        self.collection = self.client.get_or_create_collection("code_review")
        # 延迟加载嵌入模型
        self.embedding_model = None
    
    def add_documents(self, documents: List[Dict[str, Any]]):
        """添加文档到向量数据库"""
        if not self.embedding_model:
            # 尝试加载嵌入模型
            try:
                self.embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                print(f"Error loading embedding model: {e}")
                return
        
        for doc in documents:
            try:
                # 生成嵌入向量
                embedding = self.embedding_model.encode(doc["content"]).tolist()
                # 添加到集合
                self.collection.add(
                    documents=[doc["content"]],
                    metadatas=[{"source": doc["source"], "path": doc.get("path", "")}],
                    ids=[doc["id"]],
                    embeddings=[embedding]
                )
            except Exception as e:
                print(f"Error adding document {doc.get('id', 'unknown')}: {e}")
    
    def search(self, query: str, k: int = 5) -> List[Dict[str, Any]]:
        """搜索相关文档"""
        if not self.embedding_model:
            # 尝试加载嵌入模型
            try:
                self.embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                print(f"Error loading embedding model: {e}")
                return []
        
        try:
            # 生成查询向量
            query_embedding = self.embedding_model.encode(query).tolist()
            # 执行搜索
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=k,
                include=["documents", "metadatas", "distances"]
            )
            # 格式化结果
            formatted_results = []
            if results and "documents" in results and results["documents"]:
                for i in range(len(results["documents"][0])):
                    formatted_results.append({
                        "content": results["documents"][0][i],
                        "metadata": results["metadatas"][0][i] if results["metadatas"] and results["metadatas"][0] else {},
                        "distance": results["distances"][0][i] if results["distances"] and results["distances"][0] else 0
                    })
            return formatted_results
        except Exception as e:
            print(f"Error searching documents: {e}")
            return []
    
    def update_document(self, document_id: str, content: str, metadata: Dict[str, Any]):
        """更新文档"""
        if not self.embedding_model:
            # 尝试加载嵌入模型
            try:
                self.embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                print(f"Error loading embedding model: {e}")
                return
        
        try:
            embedding = self.embedding_model.encode(content).tolist()
            self.collection.update(
                ids=[document_id],
                documents=[content],
                metadatas=[metadata],
                embeddings=[embedding]
            )
        except Exception as e:
            print(f"Error updating document {document_id}: {e}")
    
    def delete_document(self, document_id: str):
        """删除文档"""
        try:
            self.collection.delete(ids=[document_id])
        except Exception as e:
            print(f"Error deleting document {document_id}: {e}")
    
    def clear_collection(self):
        """清空集合"""
        try:
            self.client.delete_collection("code_review")
            self.collection = self.client.get_or_create_collection("code_review")
        except Exception as e:
            print(f"Error clearing collection: {e}")

# 全局向量存储实例
vector_store = VectorStore()


def index_project_files(project_path):
    """索引项目文件到向量数据库"""
    documents = []
    for root, dirs, files in os.walk(project_path):
        # 过滤不需要的目录
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', '__pycache__', 'out', 'build']]
        for file in files:
            if file.endswith(('.py', '.js', '.ts', '.java')):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    # 限制文件大小
                    if len(content) > 100000:
                        content = content[:100000]
                    documents.append({
                        "id": f"file_{file_path}",
                        "content": content,
                        "source": "code",
                        "path": file_path
                    })
                except Exception as e:
                    print(f"Error reading {file_path}: {e}")
    # 批量添加到向量数据库
    if documents:
        vector_store.add_documents(documents)
        print(f"Indexed {len(documents)} files")
    else:
        print("No files found to index")
