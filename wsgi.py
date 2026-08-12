# Archivo WSGI para PythonAnywhere.
# En PythonAnywhere: Web > Edit WSGI configuration file, pegar el contenido
# y reemplazar USUARIO por el nombre de tu cuenta.
import os
import sys

project_home = u"/home/USUARIO/sistema-angie"
if project_home not in sys.path:
    sys.path.insert(0, project_home)

from app import app as application
