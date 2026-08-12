# Archivo WSGI para PythonAnywhere.
# En PythonAnywhere: Web > Edit WSGI configuration file, pegar este contenido.
import os
import sys

project_home = u"/home/Angie112890/Variedades-angie"
if project_home not in sys.path:
    sys.path.insert(0, project_home)

from app import app as application
