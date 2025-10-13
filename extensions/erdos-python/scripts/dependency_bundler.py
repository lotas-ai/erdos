# Copyright (C) 2025 Lotas Inc. All rights reserved.
# Licensed under the AGPL-3.0 License. See License.txt in the project root for license information.

import re
import subprocess
import sys
from pathlib import Path
from typing import List


class DependencyPackager:
    """Manages the process of bundling external dependencies with namespace rewriting."""

    def __init__(
        self,
        target_path: Path,
        import_namespace: str,
        requirements_path: Path,
    ):
        self.target_path = target_path
        self.import_namespace = import_namespace
        self.requirements_path = requirements_path

    def execute(self) -> None:
        """Execute the complete dependency bundling workflow."""
        self._purge_existing_dependencies()
        self._fetch_dependencies()
        discovered_packages = self._discover_packages()
        self._transform_import_statements(discovered_packages)

    def _purge_existing_dependencies(self) -> None:
        """Remove all existing vendored dependencies from target directory."""
        print("Purging existing dependencies")
        if not self.target_path.exists():
            return

        for entry in self.target_path.iterdir():
            if entry.is_dir() and not entry.is_symlink():
                self._remove_directory_tree(entry)
            else:
                entry.unlink()

    @staticmethod
    def _remove_directory_tree(path: Path) -> None:
        """Recursively delete directory and contents."""
        for child in path.iterdir():
            if child.is_dir() and not child.is_symlink():
                DependencyPackager._remove_directory_tree(child)
            else:
                child.unlink()
        path.rmdir()

    def _fetch_dependencies(self) -> None:
        """Install packages using pip with secure installation flags."""
        print("Fetching dependencies")
        installation_args = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-t",
            str(self.target_path),
            "--no-cache-dir",
            "--implementation",
            "py",
            "--no-deps",
            "--require-hashes",
            "--only-binary",
            ":all:",
            "-r",
            str(self.requirements_path),
        ]
        self._execute_command(installation_args)

    def _discover_packages(self) -> List[str]:
        """Scan target directory to identify installed packages."""
        packages = []
        for entry in self.target_path.iterdir():
            if entry.is_dir():
                packages.append(entry.name)
            elif entry.name.endswith(".py"):
                packages.append(entry.stem)
            else:
                print(f"Unexpected non-Python file discovered: {entry}")
        return packages


    def _transform_import_statements(self, packages: List[str]) -> None:
        """Recursively transform import statements across all Python files."""
        print("Transforming import statements")
        self._process_directory(self.target_path, packages)

    def _process_directory(self, directory: Path, packages: List[str]) -> None:
        """Recursively process all Python files in directory."""
        for entry in directory.iterdir():
            if entry.is_dir():
                self._process_directory(entry, packages)
            elif entry.suffix == ".py":
                self._transform_file(entry, packages)

    def _transform_file(self, file_path: Path, packages: List[str]) -> None:
        """Apply import transformations to a single Python file."""
        content = file_path.read_text(encoding="utf-8")

        if self.import_namespace:
            content = self._rewrite_package_imports(content, packages, file_path)

        file_path.write_text(content, encoding="utf-8")

    def _rewrite_package_imports(
        self, content: str, packages: List[str], file_path: Path
    ) -> str:
        """Rewrite imports to use the vendored namespace."""
        for package in packages:
            content = self._handle_simple_import(content, package)
            content = self._handle_aliased_import(content, package)
            self._validate_no_invalid_imports(content, package, file_path)
            content = self._handle_from_import(content, package)
        return content

    def _handle_simple_import(self, content: str, package: str) -> str:
        """Transform 'import package' to 'from namespace import package'."""
        pattern = re.compile(
            rf"^(\s*)import {re.escape(package)}(\s|$)", re.MULTILINE
        )
        replacement = rf"\1from {self.import_namespace} import {package}\2"
        return pattern.sub(replacement, content)

    def _handle_aliased_import(self, content: str, package: str) -> str:
        """Transform 'import package.module as alias'."""
        pattern = re.compile(
            rf"^(\s*)import {re.escape(package)}(\.\S+)(?=\s+as)", re.MULTILINE
        )
        replacement = rf"\1import {self.import_namespace}.{package}\2"
        return pattern.sub(replacement, content)

    def _validate_no_invalid_imports(
        self, content: str, package: str, file_path: Path
    ) -> None:
        """Check for import patterns that cannot be transformed."""
        search_pattern = re.compile(
            rf"^\s*(import {re.escape(package)}\.\S+)", re.MULTILINE
        )
        match = search_pattern.search(content)
        if match:
            line_num = content[: match.start()].count("\n") + 1
            raise PackagingError(
                f"Cannot transform import statement in '{file_path}' at line {line_num}:\n"
                f"  {match.group(1)}\n"
                f"This import pattern requires manual patching for namespace transformation."
            )

    def _handle_from_import(self, content: str, package: str) -> str:
        """Transform 'from package import ...' statements."""
        pattern = re.compile(
            rf"^(\s*)from {re.escape(package)}(\.|\s)", re.MULTILINE
        )
        replacement = rf"\1from {self.import_namespace}.{package}\2"
        return pattern.sub(replacement, content)

    def _execute_command(self, command_args: List[str]) -> None:
        """Execute subprocess command with real-time output streaming."""
        command_string = " ".join(command_args)
        print(f"Executing: {command_string}")

        process = subprocess.Popen(
            command_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
        )

        assert process.stdout is not None

        while True:
            output_line = process.stdout.readline()
            if output_line:
                print(output_line.rstrip())

            return_code = process.poll()
            if return_code is not None:
                break

        if return_code != 0:
            raise PackagingError(f"Command failed with exit code {return_code}")


class PackagingError(Exception):
    """Error during dependency packaging operations."""
    pass


def main() -> None:
    """Configure and run the dependency packaging process."""
    packager = DependencyPackager(
        target_path=Path("python_files/lotas/erdos/_vendor/"),
        import_namespace="erdos._vendor",
        requirements_path=Path("python_files/erdos_requirements/requirements.txt"),
    )
    packager.execute()


if __name__ == "__main__":
    main()



