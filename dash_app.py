import pandas as pd
from voth import read_input, prepare_dataframe, compute_bottleneck_score
import dash
from dash import dcc, html, dash_table
from dash.dependencies import Input, Output
import plotly.express as px


DATA_PATH = 'Banco de Dados.xlsx'


def load_data(path=DATA_PATH):
    df_raw = read_input(path)
    df = prepare_dataframe(df_raw)
    df = compute_bottleneck_score(df)
    return df


df = load_data()

app = dash.Dash(__name__, title='Dashboard VOTH - Gargalos', suppress_callback_exceptions=True)

app.layout = html.Div([
    html.Div([
        html.H1('Dashboard de Gargalos - VOTH', style={'textAlign': 'center'}),
        html.P('Analise de restrições, clusterização e machine learning', style={'textAlign': 'center'})
    ], style={'marginBottom': '30px'}),

    html.Div([
        html.Div([html.Strong('Total de processos:'), html.Div(len(df), id='total-processos')], className='card'),
        html.Div([html.Strong('Gargalos Altos:'), html.Div((df['Impacto'] == 'Alto impacto (gargalo crítico)').sum(), id='gargalos-altos')], className='card'),
        html.Div([html.Strong('Médios:'), html.Div((df['Impacto'] == 'Médio impacto (atenção)').sum(), id='gargalos-medios')], className='card'),
        html.Div([html.Strong('Baixos:'), html.Div((df['Impacto'] == 'Baixo impacto (fluido)').sum(), id='gargalos-baixos')], className='card'),
    ], style={'display': 'grid', 'gridTemplateColumns': 'repeat(4, 1fr)', 'gap': '15px', 'marginBottom': '30px'}),

    html.Div([
        html.Div([html.Label('Filtro Impacto'),
                  dcc.Dropdown(id='impact-filter', options=[
                      {'label': 'Todos', 'value': 'all'},
                      {'label': 'Alto impacto (gargalo crítico)', 'value': 'Alto impacto (gargalo crítico)'},
                      {'label': 'Médio impacto (atenção)', 'value': 'Médio impacto (atenção)'},
                      {'label': 'Baixo impacto (fluido)', 'value': 'Baixo impacto (fluido)'}],
                  value='all')], style={'width': '25%', 'padding': '0 10px'}),
        html.Div([html.Label('K (KMeans)'), dcc.Slider(id='k-clusters', min=2, max=8, step=1, value=3,
                                                         marks={i: str(i) for i in range(2, 9)})], style={'width': '60%', 'padding': '0 10px'}),
    ], style={'display': 'flex', 'gap': '20px', 'marginBottom': '25px'}),

    dcc.Graph(id='bottleneck-score', style={'height': '480px'}),
    dcc.Graph(id='scatter-time-fila', style={'height': '480px'}),
    dcc.Graph(id='availability-bar', style={'height': '380px'}),

    html.Div([html.H3('Tabela de Processos'),
              dash_table.DataTable(id='table-gargalos',
                                   columns=[{'name': c, 'id': c} for c in df.columns],
                                   data=df.to_dict('records'),
                                   page_size=12,
                                   sort_action='native',
                                   filter_action='native',
                                   style_table={'overflowX': 'auto'},
                                   style_cell={'textAlign': 'left', 'minWidth': '100px', 'width': '160px', 'maxWidth': '250px'},
                                   style_data_conditional=[
                                       {
                                           'if': {'filter_query': '{Impacto} = "Alto impacto (gargalo crítico)"'},
                                           'backgroundColor': '#ffcccc',
                                           'color': '#6b0000'
                                       },
                                       {
                                           'if': {'filter_query': '{Impacto} = "Médio impacto (atenção)"'},
                                           'backgroundColor': '#fff2cc',
                                           'color': '#664d03'
                                       },
                                       {
                                           'if': {'filter_query': '{Impacto} = "Baixo impacto (fluido)"'},
                                           'backgroundColor': '#d4f4d7',
                                           'color': '#1f5d2c'
                                       }
                                   ])],
             style={'marginTop': '30px'})
], style={'margin': '20px'})


@app.callback(
    Output('bottleneck-score', 'figure'),
    Output('scatter-time-fila', 'figure'),
    Output('availability-bar', 'figure'),
    Output('table-gargalos', 'data'),
    Input('impact-filter', 'value'),
    Input('k-clusters', 'value')
)
def update_dashboard(impact_filter, k_clusters):
    dff = df.copy()
    if impact_filter != 'all':
        dff = dff[dff['Impacto'] == impact_filter]

    # KMeans para clusterização visual
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import MinMaxScaler

    features = ['Tempo', 'Fila', 'Dependencias', 'Disponibilidade']
    scaled = MinMaxScaler().fit_transform(dff[features])
    k = min(k_clusters, len(dff)) if len(dff) > 0 else 1
    if k > 1:
        labels = KMeans(n_clusters=k, random_state=42, n_init='auto').fit_predict(scaled)
    else:
        labels = [0] * len(dff)
    dff['Cluster'] = labels

    fig1 = px.bar(dff.sort_values('BottleneckScore', ascending=False), x='Posto', y='BottleneckScore', color='Impacto',
                  hover_data=['Tempo', 'Fila', 'Dependencias', 'Disponibilidade', 'RankGargalo'],
                  title='Bottleneck Score por Posto (gargalos + impacto)')

    fig2 = px.scatter(dff, x='Tempo', y='Fila', color='Cluster', symbol='Impacto', size='Dependencias',
                      hover_data=['Posto', 'BottleneckScore', 'Ordem', 'Disponibilidade'],
                      title='Tempo x Fila (Clusters)')

    fig3 = px.bar(dff.sort_values('Disponibilidade', ascending=False), x='Posto', y='Disponibilidade', color='Impacto',
                  title='Disponibilidade relativa por Posto')

    return fig1, fig2, fig3, dff.to_dict('records')


if __name__ == '__main__':
    app.run(debug=True, port=8050)
