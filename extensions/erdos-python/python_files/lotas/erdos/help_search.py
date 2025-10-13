# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

from __future__ import annotations

import ast
import builtins
import importlib.metadata
import json
import logging
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)


class PythonHelpCache:
    """
    AST-based help cache with automatic invalidation.
    Like R's help/aliases.rds but built dynamically via AST parsing.
    Completely non-blocking - searches work immediately with partial data.
    """
    
    def __init__(self, cache_dir: Optional[Path] = None):
        if cache_dir is None:
            cache_dir = Path.home() / '.erdos' / 'python_help_cache'
        
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Per-environment cache (different cache for different Python installations)
        # Use sys.prefix directly to create a deterministic identifier
        # Replace special chars with underscores for safe filename
        env_id = sys.prefix.replace('/', '_').replace('\\', '_').replace(':', '_')
        self.manifest_file = self.cache_dir / f'manifest{env_id}.json'
        
        self._building = False
        self._build_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
    
    def get_package_fingerprint(self, package_name: str) -> Optional[str]:
        """Get fingerprint that changes when package is updated."""
        try:
            dist = importlib.metadata.distribution(package_name)
            version = dist.version
            
            metadata_path = dist._path
            latest_mtime = max(
                f.stat().st_mtime 
                for f in metadata_path.iterdir() 
                if f.is_file()
            )
            
            return f"{version}:{latest_mtime}"
        except Exception:
            return None
    
    def load_manifest(self) -> Dict:
        """Load cache manifest."""
        if not self.manifest_file.exists():
            return {'packages': {}}
        
        try:
            return json.loads(self.manifest_file.read_text())
        except Exception:
            return {'packages': {}}
    
    def save_manifest(self, manifest: Dict):
        """Save cache manifest atomically."""
        try:
            temp_file = self.manifest_file.with_suffix('.tmp')
            temp_file.write_text(json.dumps(manifest, indent=2))
            temp_file.replace(self.manifest_file)
        except Exception as e:
            logger.error(f"Failed to save manifest: {e}")
    
    def get_cached_topics(self) -> List[str]:
        """Get all cached topics - NEVER blocks."""
        topics = []
        
        try:
            manifest = self.load_manifest()
            
            # Load builtins first
            if 'builtins' in manifest:
                cache_file = self.cache_dir / manifest['builtins']['cache_file']
                if cache_file.exists():
                    try:
                        builtins_topics = json.loads(cache_file.read_text())
                        topics.extend(builtins_topics)
                    except Exception:
                        pass
            
            # Load all packages
            for pkg, info in manifest.get('packages', {}).items():
                cache_file = self.cache_dir / info['cache_file']
                if cache_file.exists():
                    try:
                        pkg_topics = json.loads(cache_file.read_text())
                        topics.extend(pkg_topics)
                    except Exception:
                        pass
        except Exception as e:
            logger.debug(f"Error loading cached topics: {e}")
        
        return topics
    
    def check_for_changes(self) -> Tuple[List[str], List[str], List[str]]:
        """
        Check which packages need cache rebuild.
        Returns: (new_packages, updated_packages, removed_packages)
        """
        manifest = self.load_manifest()
        cached_packages = manifest.get('packages', {})
        
        installed = {}
        for dist in importlib.metadata.distributions():
            fp = self.get_package_fingerprint(dist.name)
            if fp:
                installed[dist.name] = fp
        
        new_packages = []
        updated_packages = []
        
        for pkg, fingerprint in installed.items():
            if pkg not in cached_packages:
                new_packages.append(pkg)
            elif cached_packages[pkg].get('fingerprint') != fingerprint:
                updated_packages.append(pkg)
        
        removed_packages = [
            pkg for pkg in cached_packages 
            if pkg not in installed
        ]
        
        return new_packages, updated_packages, removed_packages
    
    def build_package_index_ast(self, package_name: str) -> List[str]:
        """Build help index for one package using AST parsing."""
        topics = [package_name]
        
        try:
            dist = importlib.metadata.distribution(package_name)
            
            if dist.read_text('top_level.txt'):
                top_levels = dist.read_text('top_level.txt').strip().split('\n')
            else:
                top_levels = [package_name]
            
            for top_level in top_levels:
                try:
                    package_path = Path(dist.locate_file(top_level))
                    
                    if not package_path.exists():
                        continue
                    
                    # Parse __init__.py to get package-level exports
                    if package_path.is_dir():
                        init_file = package_path / '__init__.py'
                        if init_file.exists():
                            exports = self._parse_init_exports(init_file, package_name)
                            topics.extend(exports)
                    
                    # Parse all .py files for classes and functions
                    if package_path.is_file() and package_path.suffix == '.py':
                        py_files = [package_path]
                    elif package_path.is_dir():
                        py_files = list(package_path.rglob('*.py'))
                    else:
                        py_files = []
                    
                    for py_file in py_files[:100]:  # Limit to avoid huge packages
                        if py_file.stem.startswith('_') and py_file.stem != '__init__':
                            continue
                        
                        try:
                            source = py_file.read_text(encoding='utf-8', errors='ignore')
                            
                            # Suppress SyntaxWarnings from invalid escape sequences in docstrings
                            import warnings
                            with warnings.catch_warnings():
                                warnings.simplefilter("ignore", SyntaxWarning)
                                tree = ast.parse(source)
                            
                            rel_path = py_file.relative_to(package_path.parent)
                            module_parts = list(rel_path.parts[:-1]) + [rel_path.stem]
                            if module_parts[-1] == '__init__':
                                module_parts = module_parts[:-1]
                            module_name = '.'.join(module_parts)
                            
                            for node in ast.walk(tree):
                                if isinstance(node, ast.ClassDef):
                                    topics.append(f'{module_name}.{node.name}')
                                    
                                    for item in node.body:
                                        if isinstance(item, ast.FunctionDef) and not item.name.startswith('_'):
                                            topics.append(f'{module_name}.{node.name}.{item.name}')
                                
                                elif isinstance(node, ast.FunctionDef):
                                    if not node.name.startswith('_'):
                                        topics.append(f'{module_name}.{node.name}')
                        
                        except Exception:
                            continue
                
                except Exception:
                    continue
        
        except Exception as e:
            logger.debug(f"Error indexing {package_name}: {e}")
        
        return list(set(topics))
    
    def _parse_init_exports(self, init_file: Path, package_name: str) -> List[str]:
        """Parse __init__.py to find package-level exports like DataFrame, read_csv."""
        exports = []
        
        try:
            source = init_file.read_text(encoding='utf-8', errors='ignore')
            
            # Suppress SyntaxWarnings from invalid escape sequences
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", SyntaxWarning)
                tree = ast.parse(source)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    if node.module:
                        for alias in node.names:
                            if alias.name != '*':
                                export_name = alias.asname or alias.name
                                exports.append(f'{package_name}.{export_name}')
                
                elif isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name) and target.id == '__all__':
                            if isinstance(node.value, (ast.List, ast.Tuple)):
                                for elt in node.value.elts:
                                    if isinstance(elt, ast.Constant):
                                        exports.append(f'{package_name}.{elt.value}')
        
        except Exception:
            pass
        
        return exports
    
    def _discover_builtins(self) -> List[str]:
        """Discover built-in functions, types, and constants."""
        builtins_topics = []
        
        try:
            import builtins
            
            for name in dir(builtins):
                if not name.startswith('_'):
                    obj = getattr(builtins, name)
                    # Include functions, types, and some special objects
                    if callable(obj) or isinstance(obj, type):
                        builtins_topics.append(name)
                        builtins_topics.append(f'builtins.{name}')
        
        except Exception as e:
            logger.debug(f"Error discovering builtins: {e}")
        
        return builtins_topics
    
    def build_cache_async(self):
        """Start building cache in background - returns immediately."""
        with self._lock:
            if self._building:
                return
            
            self._building = True
        
        self._build_thread = threading.Thread(
            target=self._build_cache_worker,
            daemon=True,
            name="PythonHelpCacheBuilder"
        )
        self._build_thread.start()
        logger.info("Help cache building started in background")
    
    def _build_cache_worker(self):
        """Worker that builds cache - runs in background thread."""
        try:
            manifest = self.load_manifest()
            need_builtins = 'builtins' not in manifest
            
            new, updated, removed = self.check_for_changes()
            
            if not new and not updated and not removed and not need_builtins:
                logger.info("Help cache is up to date")
                return
            
            logger.info(f"Building help cache: {len(new)} new, {len(updated)} updated, {len(removed)} removed")
            
            # Always cache builtins if missing or if doing any build
            if need_builtins or new or updated or removed:
                try:
                    builtins_topics = self._discover_builtins()
                    builtins_cache_file = self.cache_dir / 'builtins.json'
                    builtins_cache_file.write_text(json.dumps(builtins_topics))
                    manifest['builtins'] = {
                        'cache_file': 'builtins.json',
                        'topics_count': len(builtins_topics),
                        'indexed_at': time.time()
                    }
                    logger.info(f"Cached {len(builtins_topics)} built-in topics")
                except Exception as e:
                    logger.debug(f"Failed to cache builtins: {e}")
            
            for pkg in removed:
                if pkg in manifest['packages']:
                    cache_file = self.cache_dir / manifest['packages'][pkg]['cache_file']
                    if cache_file.exists():
                        cache_file.unlink()
                    del manifest['packages'][pkg]
            
            for pkg in new + updated:
                try:
                    topics = self.build_package_index_ast(pkg)
                    fingerprint = self.get_package_fingerprint(pkg)
                    
                    dist = importlib.metadata.distribution(pkg)
                    cache_file_name = f"{pkg}-{dist.version}.json"
                    cache_file = self.cache_dir / cache_file_name
                    
                    cache_file.write_text(json.dumps(topics))
                    
                    manifest['packages'][pkg] = {
                        'version': dist.version,
                        'fingerprint': fingerprint,
                        'cache_file': cache_file_name,
                        'indexed_at': time.time(),
                        'topics_count': len(topics)
                    }
                    
                    self.save_manifest(manifest)
                
                except Exception as e:
                    logger.debug(f"Failed to index {pkg}: {e}")
            
            logger.info(f"Help cache build complete: {len(manifest['packages'])} packages indexed")
            
        except Exception as e:
            logger.error(f"Error in cache build worker: {e}", exc_info=True)
        
        finally:
            with self._lock:
                self._building = False


def is_subsequence(haystack: str, needle: str) -> bool:
    """Check if needle is a subsequence of haystack."""
    if not needle:
        return True
    if not haystack:
        return False
    
    h_idx = 0
    n_idx = 0
    
    while h_idx < len(haystack) and n_idx < len(needle):
        if haystack[h_idx] == needle[n_idx]:
            n_idx += 1
            if n_idx == len(needle):
                return True
        h_idx += 1
    
    return False


def score_match(suggestion: str, query: str) -> int:
    """Score a match for ranking. Lower is better."""
    if suggestion == query:
        return 0
    
    if not is_subsequence(suggestion.lower(), query.lower()):
        return 999999
    
    penalty = 0
    
    suggestion_lower = suggestion.lower()
    query_lower = query.lower()
    
    s_idx = 0
    for q_char in query_lower:
        while s_idx < len(suggestion_lower):
            if suggestion_lower[s_idx] == q_char:
                penalty += s_idx
                s_idx += 1
                break
            s_idx += 1
    
    return penalty


_help_cache: Optional[PythonHelpCache] = None


def get_cache() -> PythonHelpCache:
    """Get the global help cache instance."""
    global _help_cache
    if _help_cache is None:
        _help_cache = PythonHelpCache()
    return _help_cache


def warm_help_cache():
    """
    Pre-warm the help cache by doing initial discovery in background.
    This is completely non-blocking and returns immediately.
    """
    cache = get_cache()
    cache.build_cache_async()


def search_help_topics_rpc(query: str = "") -> List[str]:
    """
    RPC entry point for help topic search.
    Returns immediately with whatever is currently cached.
    """
    cache = get_cache()
    
    all_topics = cache.get_cached_topics()
    
    if not query:
        return all_topics[:50]
    
    query_lower = query.lower()
    
    scores = {}
    for topic in all_topics:
        if is_subsequence(topic.lower(), query_lower):
            scores[topic] = score_match(topic, query)
    
    matches = sorted(scores.keys(), key=lambda t: (scores[t], len(t)))
    
    # Filter to topics that have the first query char in the right place
    # (either at start of topic, or after a dot for qualified names)
    if query:
        first_char = re.escape(query[0].lower())
        # Match topics like: "DataFrame", "pandas.DataFrame", "pd.DataFrame"
        pattern = f'(^|\\.).*{first_char}'
        matches = [m for m in matches if re.search(pattern, m, re.IGNORECASE)]
    
    return matches[:50]


def clear_help_cache():
    """Clear the help cache (for testing or manual cache reset)."""
    global _help_cache
    if _help_cache:
        import shutil
        if _help_cache.cache_dir.exists():
            shutil.rmtree(_help_cache.cache_dir)
        _help_cache = None
